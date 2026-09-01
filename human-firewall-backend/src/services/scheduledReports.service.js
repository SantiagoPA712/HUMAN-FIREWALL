/**
 * Reportes automaticos periodicos.
 *
 * HU: "Yo como sistema quiero generar reportes automaticos de forma periodica
 * para que RH, seguridad y gerencia reciban informacion actualizada sin
 * necesidad de generarla manualmente."
 *
 * ---------------------------------------------------------------------
 * Las tres piezas y por que estan separadas
 * ---------------------------------------------------------------------
 *   1. El SCHEDULER (dispararProgramacionesVencidas) solo decide QUE hay que
 *      generar. No genera nada: encola.
 *   2. El JOB (generarReporteProgramado) genera y persiste el resultado.
 *      Corre fuera del ciclo de request y es idempotente.
 *   3. La COLA DE AVISOS (procesarNotificacionesPendientes) entrega, reintenta
 *      y se rinde despues de 3 intentos.
 *
 * Si las tres vivieran juntas, un servidor SMTP caido dejaria sin generar el
 * reporte, y una generacion lenta bloquearia el disparo de las demas. Cada
 * pieza falla sola.
 *
 * ---------------------------------------------------------------------
 * Como se evita el disparo duplicado (criterio tecnico 1)
 * ---------------------------------------------------------------------
 * El scheduler abre una transaccion, toma la programacion con FOR UPDATE SKIP
 * LOCKED, adelanta next_run_at y publica el evento CON EL MISMO cliente. Es el
 * patron outbox que ya usa el resto del proyecto: el evento existe si y solo
 * si el adelanto de next_run_at se confirmo. No hay ventana donde uno ocurra
 * sin el otro, ni con dos instancias del servidor corriendo a la vez.
 *
 * Y como segunda red, el propio job verifica el periodo antes de generar
 * (criterio tecnico 2): aunque un evento se duplicara, el reporte no.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../config/db');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');
const reportsService = require('./reports.service');
const exportsService = require('./reportExports.service');
const orgReportsService = require('./orgReports.service');
const notificationsService = require('./notifications.service');

/** Cada cuanto revisa el scheduler si vencio alguna programacion. */
const INTERVALO_SCHEDULER_MS =
    (Number(process.env.REPORT_SCHEDULER_INTERVAL_SECONDS) || 60) * 1000;

/**
 * Base del backoff de los avisos, en segundos. La espera es base * 2^intento:
 * 2, 4 y 8 minutos con el valor por defecto.
 */
const BACKOFF_BASE_SEGUNDOS = Number(process.env.REPORT_NOTIFY_BACKOFF_SECONDS) || 60;

/** Criterio tecnico 4: tres intentos y despues se marca fallido. */
const MAX_INTENTOS_AVISO = 3;

/**
 * A quien se le avisa cuando la generacion falla (criterio de aceptacion 3).
 *
 * No hay un rol 'soporte' en el sistema, asi que el equipo tecnico son los
 * administradores. Queda configurable para el dia que exista uno.
 */
const ROLES_TECNICOS = (process.env.REPORT_TECH_ROLES || 'admin')
    .split(',').map(r => r.trim()).filter(Boolean);

/** Donde quedan los archivos generados. Fuera del control de versiones. */
const DIR_REPORTES = path.join(__dirname, '..', '..', 'storage', 'reports');

const TIPOS = ['performance', 'organizational'];
const FRECUENCIAS = ['daily', 'weekly', 'monthly'];
const FORMATOS = ['csv', 'pdf'];

/** Roles que pueden estar suscritos. Mismo catalogo que el CHECK de users. */
const ROLES = ['employee', 'instructor', 'admin', 'rh', 'security', 'manager'];

/**
 * Etiquetas de los avisos.
 *
 * LISTO es ademas un evento del bus; FALLO no: nadie se suscribe a el, es
 * solo el nombre con el que el aviso queda guardado en la bandeja. Se
 * declaran juntos para que la bandeja no muestre dos convenciones distintas.
 */
const AVISOS = {
    LISTO: EVENTOS.REPORT_AUTO_GENERATED,
    FALLO: 'report.auto_failed'
};

let temporizador = null;

// ---------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------

const soloFecha = (d) => d.toISOString().slice(0, 10);

/** Numero de semana ISO 8601 de una fecha (la semana empieza el lunes). */
function semanaISO(fecha) {
    // Se corre la fecha al jueves de su semana: por definicion de ISO 8601,
    // el anio de la semana es el anio de ese jueves. Sin este paso, el 31 de
    // diciembre puede pertenecer a la semana 1 del anio siguiente y quedar
    // etiquetado con el anio equivocado.
    const jueves = new Date(fecha);
    jueves.setUTCDate(jueves.getUTCDate() + 3 - ((jueves.getUTCDay() + 6) % 7));

    const primeroDeEnero = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1));
    const dias = Math.round((jueves - primeroDeEnero) / 86400000);
    const semana = Math.ceil((dias + primeroDeEnero.getUTCDay() + 1) / 7);

    return `${jueves.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

/**
 * Periodo que cubre una corrida.
 *
 * Es el periodo YA CERRADO anterior al momento de la corrida, no el que esta
 * en curso: un reporte semanal que se dispara el lunes informa la semana
 * pasada completa. Informar la semana en curso daria un numero que cambia
 * cada dia y que nadie puede comparar con el del lunes anterior.
 *
 * @returns {{clave: string, from: string, to: string}} rango inclusivo en
 *          formato YYYY-MM-DD, que es lo que esperan los filtros del reporte.
 */
function calcularPeriodo(frecuencia, referencia = new Date()) {
    const ref = new Date(referencia);
    const hoy = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
    const DIA = 86400000;

    if (frecuencia === 'daily') {
        const ayer = new Date(hoy - DIA);
        return { clave: soloFecha(ayer), from: soloFecha(ayer), to: soloFecha(ayer) };
    }

    if (frecuencia === 'weekly') {
        // (getUTCDay() + 6) % 7 => 0 el lunes, 6 el domingo.
        const diaDeSemana = (new Date(hoy).getUTCDay() + 6) % 7;
        const lunesDeEstaSemana = hoy - diaDeSemana * DIA;
        const inicio = new Date(lunesDeEstaSemana - 7 * DIA);
        const fin = new Date(lunesDeEstaSemana - DIA);
        return { clave: semanaISO(inicio), from: soloFecha(inicio), to: soloFecha(fin) };
    }

    // mensual
    const inicio = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
    const fin = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1) - DIA);
    return {
        clave: `${inicio.getUTCFullYear()}-${String(inicio.getUTCMonth() + 1).padStart(2, '0')}`,
        from: soloFecha(inicio),
        to: soloFecha(fin)
    };
}

/**
 * Proxima ejecucion segun la frecuencia (criterio tecnico 1).
 *
 * Avanza desde la ejecucion prevista, no desde "ahora", y repite hasta pasar
 * el presente. Las dos cosas importan:
 *
 *   - Avanzar desde la prevista conserva la hora: una programacion de las
 *     08:00 sigue siendo de las 08:00 aunque el worker la haya tomado 08:04.
 *     Con `now() + intervalo` la hora se corre unos minutos en cada corrida y
 *     en un mes el reporte "de la manana" sale a la tarde.
 *
 *   - Repetir hasta pasar el presente evita la rafaga: si el servidor estuvo
 *     una semana apagado, una programacion diaria no dispara siete corridas
 *     seguidas de periodos viejos, dispara la de hoy.
 */
function calcularProximaEjecucion(frecuencia, prevista, ahora = new Date()) {
    const siguiente = new Date(prevista);
    const limite = new Date(ahora);
    let vueltas = 0;

    do {
        if (frecuencia === 'daily') siguiente.setUTCDate(siguiente.getUTCDate() + 1);
        else if (frecuencia === 'weekly') siguiente.setUTCDate(siguiente.getUTCDate() + 7);
        else siguiente.setUTCMonth(siguiente.getUTCMonth() + 1);

        // Tope de seguridad: con una fecha prevista absurdamente vieja (un
        // dato cargado a mano en 1970) el bucle diario daria decenas de miles
        // de vueltas. A partir de aca se salta al presente.
        if (++vueltas > 500) {
            const desdeAhora = new Date(limite);
            desdeAhora.setUTCDate(desdeAhora.getUTCDate() + 1);
            return desdeAhora;
        }
    } while (siguiente <= limite);

    return siguiente;
}

// ---------------------------------------------------------------------
// Scheduler (criterio tecnico 1)
// ---------------------------------------------------------------------

/**
 * Toma UNA programacion vencida, adelanta su next_run_at y encola su job.
 *
 * Todo dentro de una transaccion, con el evento publicado usando el mismo
 * cliente: o quedan las dos cosas, o ninguna.
 *
 * @returns {Promise<object|null>} lo encolado, o null si no habia nada vencido
 */
async function dispararUna(ahora = new Date()) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id, name, report_type, frequency, format, params, next_run_at
               FROM report_schedules
              WHERE is_active = true AND next_run_at <= $1::timestamptz
              ORDER BY next_run_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1`,
            [ahora.toISOString()]
        );

        if (rows.length === 0) {
            await client.query('COMMIT');
            return null;
        }

        const programacion = rows[0];
        const periodo = calcularPeriodo(programacion.frequency, ahora);
        const proxima = calcularProximaEjecucion(
            programacion.frequency, programacion.next_run_at, ahora
        );

        // Criterio tecnico 1: "debo actualizar next_run_at segun la frecuencia
        // configurada INMEDIATAMENTE al encolar, para evitar disparos
        // duplicados". Va antes del publish, en la misma transaccion.
        await client.query(
            `UPDATE report_schedules
                SET next_run_at = $2, last_run_at = $3, updated_at = now()
              WHERE id = $1`,
            [programacion.id, proxima.toISOString(), ahora.toISOString()]
        );

        // Los parametros viajan CONGELADOS dentro del evento. Si alguien edita
        // la programacion mientras el job espera en la cola, el reporte se
        // genera con los filtros que estaban vigentes cuando se disparo, que
        // son los que despues quedan escritos en report_history.params_used.
        const payload = {
            scheduleId: programacion.id,
            tipo: programacion.report_type,
            formato: programacion.format,
            periodo: periodo.clave,
            params: { ...(programacion.params || {}), from: periodo.from, to: periodo.to }
        };

        await eventBus.publish(EVENTOS.REPORT_SCHEDULED_RUN, payload, client);

        await client.query('COMMIT');

        console.log(
            `[reportes-auto] encolado schedule=${programacion.id} periodo=${periodo.clave} ` +
            `proxima=${proxima.toISOString()}`
        );

        return payload;

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/** Dispara todas las programaciones vencidas de esta vuelta. */
async function dispararProgramacionesVencidas(ahora = new Date(), maxPorTanda = 20) {
    const encolados = [];
    for (let i = 0; i < maxPorTanda; i++) {
        const encolado = await dispararUna(ahora);
        if (!encolado) break;
        encolados.push(encolado);
    }
    return encolados;
}

// ---------------------------------------------------------------------
// Generacion (criterios tecnicos 2, 3 y 5)
// ---------------------------------------------------------------------

function asegurarDirectorio() {
    fs.mkdirSync(DIR_REPORTES, { recursive: true });
}

/** Convierte los filtros del reporte al formato que espera reports.service. */
async function normalizarFiltros(params = {}) {
    const { errores, filtros } = await reportsService.validarFiltros(params);
    if (errores.length > 0) {
        const error = new Error(
            `Parametros invalidos: ${errores.map(e => `${e.campo} (${e.detalle})`).join('; ')}`
        );
        error.errores = errores;
        throw error;
    }
    return filtros;
}

/**
 * Genera el archivo del reporte y lo deja en disco.
 *
 * La generacion en si no se reimplementa: para 'performance' se reutiliza el
 * generador de exportaciones (mismo CSV, mismo PDF, mismas columnas que ve
 * RH en pantalla) y para 'organizational' el del servicio organizacional. Si
 * manana cambia una columna del reporte, cambia en los dos lugares a la vez
 * porque es el mismo codigo.
 */
async function generarArchivo({ tipo, formato, periodo, params }) {
    asegurarDirectorio();

    // Identificador aleatorio, no el id de la fila: el nombre del archivo
    // viaja en encabezados y en logs de proxys, y con un id secuencial se
    // pueden enumerar los reportes de la organizacion.
    const uid = crypto.randomBytes(12).toString('hex');

    let contenido;
    let extension = formato;

    if (tipo === 'organizational') {
        // El consolidado organizacional se arma sobre snapshots mensuales, no
        // sobre un rango de fechas suelto, asi que se le pasa el mes del
        // periodo. Solo hay version CSV: un PDF de cuatro KPIs no agrega nada
        // que el CSV no diga, y la programacion lo valida al crearse.
        const mes = periodo.length === 7 ? periodo : orgReportsService.periodoDe(new Date(params.to));
        contenido = await orgReportsService.generarCsvOrganizacional({
            periodo: mes,
            areaId: params.team_id ? Number(params.team_id) : null
        });
        extension = 'csv';
    } else {
        const filtros = await normalizarFiltros(params);
        const archivo = await exportsService.generarArchivo({
            exportUid: uid, formato, filtros
        });
        contenido = { buffer: archivo.buffer, filas: archivo.filas };
    }

    const fileName = `reporte-${tipo}-${periodo}-${uid}.${extension}`;
    fs.writeFileSync(path.join(DIR_REPORTES, fileName), contenido.buffer);

    return { fileName, filas: contenido.filas ?? null };
}

/**
 * Handler del evento de generacion. Es el job del criterio tecnico 2.
 *
 * Idempotente por (schedule_id, periodo): el bus reintenta ante un fallo, y un
 * job que generara y notificara dos veces convertiria cada reintento en un
 * correo duplicado para toda la organizacion.
 *
 * @returns {Promise<object>} { omitido } o el registro de report_history
 */
async function generarReporteProgramado({ scheduleId, tipo, formato, periodo, params }) {
    // Criterio tecnico 2: primero se pregunta si ya existe.
    const { rows: previos } = await db.query(
        `SELECT id, status FROM report_history
          WHERE schedule_id = $1 AND period = $2 AND status = 'success'`,
        [scheduleId, periodo]
    );

    if (previos.length > 0) {
        console.log(
            `[reportes-auto] schedule=${scheduleId} periodo=${periodo} ya generado ` +
            `(history=${previos[0].id}): no se regenera ni se reenvia el aviso`
        );
        return { omitido: true, historyId: previos[0].id };
    }

    const arranque = Date.now();

    try {
        const { fileName, filas } = await generarArchivo({ tipo, formato, periodo, params });

        // Criterio tecnico 3: una fila por corrida, con todo lo que pide el
        // criterio. ON CONFLICT contra el indice unico parcial: si dos
        // instancias generaron el mismo periodo a la vez, gana una sola.
        const { rows } = await db.query(
            `INSERT INTO report_history
                (schedule_id, type, period, params_used, status, file_location, row_count, duration_ms)
             VALUES ($1, $2, $3, $4, 'success', $5, $6, $7)
             ON CONFLICT (schedule_id, period) WHERE status = 'success' DO NOTHING
             RETURNING id, schedule_id, type, period, status, file_location, generated_at`,
            [scheduleId, tipo, periodo, JSON.stringify(params || {}),
             `storage/reports/${fileName}`, filas, Date.now() - arranque]
        );

        if (rows.length === 0) {
            // Otra corrida gano la carrera. El archivo que acabamos de generar
            // sobra: se borra para no dejar huerfanos en disco.
            fs.rmSync(path.join(DIR_REPORTES, fileName), { force: true });
            return { omitido: true };
        }

        const historial = rows[0];

        // Criterio tecnico 4: el aviso se ENCOLA, no se manda desde aca. Si el
        // servidor de correo esta caido, el reporte igual quedo generado.
        await eventBus.publish(EVENTOS.REPORT_AUTO_GENERATED, {
            historyId: historial.id, scheduleId, periodo
        });

        console.log(`[reportes-auto] generado schedule=${scheduleId} periodo=${periodo} archivo=${fileName}`);
        return historial;

    } catch (err) {
        return registrarFallo({ scheduleId, tipo, periodo, params, error: err, arranque });
    }
}

/**
 * Deja registrado un fallo de generacion (criterios de aceptacion 3 y
 * tecnico 5).
 *
 * El reparto de la informacion es lo importante:
 *
 *   log del servidor  -> stack trace completo, schedule_id y timestamp
 *   report_history    -> resumen tecnico corto y la referencia del log
 *   aviso al equipo tecnico -> el resumen y la referencia, para poder buscar
 *   pantalla de RH/gerencia -> mensaje generico (lo arma el controlador)
 *
 * El stack no viaja en ninguna notificacion: contiene rutas del servidor y
 * fragmentos de consultas, que es justo lo que el criterio pide no exponer.
 */
async function registrarFallo({ scheduleId, tipo, periodo, params, error, arranque }) {
    const referencia = `rep-${crypto.randomBytes(4).toString('hex')}`;
    const momento = new Date().toISOString();

    console.error(
        `[reportes-auto][${referencia}] fallo la generacion schedule=${scheduleId} ` +
        `periodo=${periodo} en=${momento}\n${error.stack || error.message}`
    );

    const resumen = `${error.name || 'Error'}: ${String(error.message).slice(0, 300)}`;

    const { rows } = await db.query(
        `INSERT INTO report_history
            (schedule_id, type, period, params_used, status, error_summary, log_reference, duration_ms)
         VALUES ($1, $2, $3, $4, 'error', $5, $6, $7)
         RETURNING id, schedule_id, type, period, status, generated_at`,
        [scheduleId, tipo, periodo, JSON.stringify(params || {}),
         resumen, referencia, Date.now() - (arranque || Date.now())]
    );

    await encolarAvisos(rows[0].id, 'error');
    await procesarNotificacionesPendientes();

    return rows[0];
}

// ---------------------------------------------------------------------
// Avisos (criterio de aceptacion 2 y criterio tecnico 4)
// ---------------------------------------------------------------------

/**
 * Encola un aviso por destinatario.
 *
 * Los destinatarios salen de los ROLES suscritos, no de una lista de personas:
 * si manana entra alguien a RH, recibe el reporte sin que nadie tenga que
 * acordarse de agregarlo.
 *
 * El ON CONFLICT DO NOTHING sobre (history_id, user_id) es la segunda mitad
 * del criterio tecnico 2 ("ni reenviar notificacion"): reprocesar el evento no
 * duplica avisos.
 */
async function encolarAvisos(historyId, kind = 'ready') {
    const roles = kind === 'error'
        ? ROLES_TECNICOS
        : (await db.query(
            `SELECT COALESCE(s.subscriber_roles, ARRAY[]::text[]) AS roles
               FROM report_history h
               LEFT JOIN report_schedules s ON s.id = h.schedule_id
              WHERE h.id = $1`,
            [historyId]
          )).rows[0]?.roles || [];

    if (!roles || roles.length === 0) {
        console.warn(`[reportes-auto] history=${historyId} sin roles suscritos: no hay a quien avisar`);
        return [];
    }

    const { rows } = await db.query(
        `INSERT INTO report_notifications (history_id, user_id, kind, max_attempts)
         SELECT $1, u.id, $2, $3
           FROM users u
          WHERE u.role = ANY($4::text[]) AND u.is_active = true
         ON CONFLICT (history_id, user_id) DO NOTHING
         RETURNING id, user_id`,
        [historyId, kind, MAX_INTENTOS_AVISO, roles]
    );

    return rows;
}

/** Arma el texto del aviso. */
function construirAviso(fila) {
    // Criterio de aceptacion 2: "el mensaje debe incluir un enlace directo al
    // reporte". Se manda el de la pantalla y el de descarga directa: el
    // primero sirve en el navegador, el segundo desde el correo.
    const enlacePantalla = `/reports/programados?reporte=${fila.history_id}`;
    const enlaceDescarga = `/api/gamification/reports/history/${fila.history_id}/download`;

    if (fila.kind === 'error') {
        // Este aviso es SOLO para el equipo tecnico (criterio tecnico 5): lleva
        // el detalle, pero nunca el stack, que queda en el log del servidor.
        return {
            title: `Fallo la generacion de "${fila.schedule_name || 'reporte programado'}"`,
            body: `El reporte ${fila.type} del periodo ${fila.period} no pudo generarse.\n` +
                  `Detalle: ${fila.error_summary}\n` +
                  `Referencia en el log: ${fila.log_reference}\n` +
                  `Programacion: ${fila.schedule_id} | Ocurrio: ${new Date(fila.generated_at).toISOString()}`,
            payload: {
                historyId: fila.history_id,
                scheduleId: fila.schedule_id,
                logReference: fila.log_reference
            },
            dedupeKey: `report-error:${fila.history_id}:${fila.user_id}`
        };
    }

    return {
        title: `Reporte listo: ${fila.schedule_name || fila.type}`,
        body: `El reporte "${fila.schedule_name || fila.type}" del periodo ${fila.period} ya esta disponible.\n` +
              `Verlo: ${enlacePantalla}\n` +
              `Descargarlo: ${enlaceDescarga}`,
        payload: {
            historyId: fila.history_id,
            periodo: fila.period,
            enlace: enlacePantalla,
            descarga: enlaceDescarga
        },
        dedupeKey: `report-ready:${fila.history_id}:${fila.user_id}`
    };
}

/**
 * Entrega un aviso. Lanza si el envio fallo, para que el llamador reintente.
 *
 * La entrega tiene dos mitades con destinos distintos: la bandeja de la
 * aplicacion (siempre funciona, es una fila en notifications) y el correo (que
 * puede fallar). notifications.service se ocupa de las dos; aca solo se
 * consulta como termino el correo:
 *
 *   'skipped' -> no hay SMTP configurado. No es un fallo: el aviso ya esta en
 *                la bandeja del usuario, que es el caso normal del proyecto.
 *   'sent'    -> entregado.
 *   'failed'  -> se reintenta, hasta agotar los intentos.
 */
async function entregarAviso(fila) {
    const aviso = construirAviso(fila);
    const evento = fila.kind === 'error' ? AVISOS.FALLO : AVISOS.LISTO;

    // Crea la notificacion si no existia. En un reintento devuelve null porque
    // el hecho ya estaba notificado, y ahi lo unico pendiente es el correo.
    await notificationsService.notificar(evento, aviso, fila.user_id);

    const estado = await notificationsService.reenviarCorreo({ dedupeKey: aviso.dedupeKey });

    if (estado === 'failed') {
        throw new Error(`no se pudo entregar el correo del aviso ${aviso.dedupeKey}`);
    }

    return estado;
}

/**
 * Procesa la cola de avisos pendientes (criterio tecnico 4).
 *
 * Backoff exponencial: base * 2^intento. Con el valor por defecto, los
 * reintentos caen a los 2, 4 y 8 minutos. Sin la espera, los tres intentos se
 * quemarian en el mismo segundo contra el mismo servidor caido, que es como
 * no tener reintentos.
 */
async function procesarNotificacionesPendientes(limite = 50) {
    const { rows } = await db.query(
        `SELECT n.id, n.history_id, n.user_id, n.kind, n.attempts, n.max_attempts,
                h.type, h.period, h.status, h.error_summary, h.log_reference,
                h.schedule_id, h.generated_at,
                s.name AS schedule_name
           FROM report_notifications n
           JOIN report_history h ON h.id = n.history_id
           LEFT JOIN report_schedules s ON s.id = h.schedule_id
          WHERE n.status = 'pending' AND n.next_attempt_at <= now()
          ORDER BY n.next_attempt_at
          LIMIT $1`,
        [limite]
    );

    let entregados = 0, fallidos = 0;

    for (const fila of rows) {
        try {
            await entregarAviso(fila);
            await db.query(
                `UPDATE report_notifications
                    SET status = 'sent', attempts = attempts + 1, sent_at = now(), last_error = NULL
                  WHERE id = $1`,
                [fila.id]
            );
            entregados++;

        } catch (err) {
            const intentos = fila.attempts + 1;
            const agotado = intentos >= fila.max_attempts;
            const espera = BACKOFF_BASE_SEGUNDOS * Math.pow(2, intentos);

            await db.query(
                `UPDATE report_notifications
                    SET status = $2,
                        attempts = $3,
                        last_error = $4,
                        next_attempt_at = now() + ($5 || ' seconds')::interval
                  WHERE id = $1`,
                [fila.id, agotado ? 'failed' : 'pending', intentos,
                 String(err.message).slice(0, 500), String(espera)]
            );

            if (agotado) fallidos++;
            console.warn(
                `[reportes-auto] aviso ${fila.id} intento ${intentos}/${fila.max_attempts}: ${err.message}` +
                (agotado ? ' -> marcado como fallido definitivamente' : ` -> reintento en ${espera}s`)
            );
        }
    }

    return { procesados: rows.length, entregados, fallidos };
}

/** Handler del evento "reporte listo": encola los avisos e intenta el primero. */
async function avisarReporteListo({ historyId }) {
    await encolarAvisos(historyId, 'ready');
    return procesarNotificacionesPendientes();
}

// ---------------------------------------------------------------------
// Configuracion de programaciones
// ---------------------------------------------------------------------

/**
 * Valida el cuerpo de una programacion.
 *
 * Los filtros se validan contra la base con el MISMO validador del reporte de
 * RH: un equipo inexistente se rechaza al configurar la programacion, y no
 * semanas despues cuando el job falle de madrugada.
 *
 * @param {object} entrada
 * @param {boolean} parcial  true en PATCH: solo se valida lo que vino
 * @returns {Promise<{errores: Array, valores: object}>}
 */
async function validarProgramacion(entrada = {}, { parcial = false } = {}) {
    const errores = [];
    const valores = {};
    const tiene = (campo) => entrada[campo] !== undefined && entrada[campo] !== null;

    const exigido = (campo) => !parcial && !tiene(campo);

    if (tiene('name')) {
        const nombre = String(entrada.name).trim();
        if (nombre.length === 0 || nombre.length > 120) {
            errores.push({ campo: 'name', detalle: 'Debe tener entre 1 y 120 caracteres.' });
        } else {
            valores.name = nombre;
        }
    } else if (exigido('name')) {
        errores.push({ campo: 'name', detalle: 'Es obligatorio.' });
    }

    for (const [campo, validos] of [['report_type', TIPOS], ['frequency', FRECUENCIAS], ['format', FORMATOS]]) {
        if (tiene(campo)) {
            const valor = String(entrada[campo]).toLowerCase();
            if (!validos.includes(valor)) {
                errores.push({ campo, detalle: `Valor invalido "${entrada[campo]}". Validos: ${validos.join(', ')}.` });
            } else {
                valores[campo] = valor;
            }
        } else if (exigido(campo) && campo !== 'format') {
            errores.push({ campo, detalle: 'Es obligatorio.' });
        }
    }

    // El consolidado organizacional solo se genera en CSV. Se avisa al
    // configurar en vez de dejar que el job falle todos los meses.
    if (valores.report_type === 'organizational' && valores.format === 'pdf') {
        errores.push({
            campo: 'format',
            detalle: 'El reporte organizacional solo se genera en csv.'
        });
    }

    if (tiene('subscriber_roles')) {
        const roles = Array.isArray(entrada.subscriber_roles)
            ? entrada.subscriber_roles.map(r => String(r).trim()).filter(Boolean)
            : [];

        if (roles.length === 0) {
            errores.push({ campo: 'subscriber_roles', detalle: 'Debe indicar al menos un rol suscrito.' });
        } else {
            const invalidos = roles.filter(r => !ROLES.includes(r));
            if (invalidos.length > 0) {
                errores.push({
                    campo: 'subscriber_roles',
                    detalle: `Rol(es) inexistente(s): ${invalidos.join(', ')}. Validos: ${ROLES.join(', ')}.`
                });
            } else {
                valores.subscriber_roles = roles;
            }
        }
    } else if (exigido('subscriber_roles')) {
        errores.push({ campo: 'subscriber_roles', detalle: 'Es obligatorio.' });
    }

    if (tiene('params')) {
        const params = entrada.params;
        if (typeof params !== 'object' || Array.isArray(params)) {
            errores.push({ campo: 'params', detalle: 'Debe ser un objeto con los filtros del reporte.' });
        } else {
            const { errores: erroresFiltro } = await reportsService.validarFiltros(params);
            errores.push(...erroresFiltro.map(e => ({ campo: `params.${e.campo}`, detalle: e.detalle })));
            if (erroresFiltro.length === 0) valores.params = params;
        }
    }

    if (tiene('is_active')) {
        if (typeof entrada.is_active !== 'boolean') {
            errores.push({ campo: 'is_active', detalle: 'Debe ser true o false.' });
        } else {
            valores.is_active = entrada.is_active;
        }
    }

    if (tiene('next_run_at')) {
        const fecha = new Date(entrada.next_run_at);
        if (Number.isNaN(fecha.getTime())) {
            errores.push({ campo: 'next_run_at', detalle: 'Fecha invalida. Se espera ISO 8601.' });
        } else {
            valores.next_run_at = fecha.toISOString();
        }
    }

    return { errores, valores };
}

async function listarProgramaciones() {
    const { rows } = await db.query(
        `SELECT s.id, s.name, s.report_type, s.frequency, s.format, s.params,
                s.subscriber_roles, s.is_active, s.next_run_at, s.last_run_at,
                s.created_at, s.updated_at,
                (SELECT COUNT(*)::int FROM report_history h WHERE h.schedule_id = s.id) AS generados,
                (SELECT MAX(h.generated_at) FROM report_history h
                  WHERE h.schedule_id = s.id AND h.status = 'success') AS ultimo_exitoso
           FROM report_schedules s
          ORDER BY s.is_active DESC, s.next_run_at`
    );
    return rows;
}

async function crearProgramacion(valores, userId) {
    const { rows } = await db.query(
        `INSERT INTO report_schedules
            (name, report_type, frequency, format, params, subscriber_roles, next_run_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8)
         RETURNING *`,
        [valores.name, valores.report_type, valores.frequency, valores.format || 'csv',
         JSON.stringify(valores.params || {}), valores.subscriber_roles,
         valores.next_run_at || null, userId]
    );
    return rows[0];
}

/**
 * Actualiza una programacion.
 *
 * Solo escribe los campos que vinieron: un PATCH que manda la frecuencia no
 * puede borrar los roles suscritos por omision.
 */
async function actualizarProgramacion(id, valores) {
    const campos = [];
    const params = [];

    const asignar = (columna, valor) => {
        params.push(valor);
        campos.push(`${columna} = $${params.length}`);
    };

    if (valores.name !== undefined) asignar('name', valores.name);
    if (valores.report_type !== undefined) asignar('report_type', valores.report_type);
    if (valores.frequency !== undefined) asignar('frequency', valores.frequency);
    if (valores.format !== undefined) asignar('format', valores.format);
    if (valores.params !== undefined) asignar('params', JSON.stringify(valores.params));
    if (valores.subscriber_roles !== undefined) asignar('subscriber_roles', valores.subscriber_roles);
    if (valores.is_active !== undefined) asignar('is_active', valores.is_active);
    if (valores.next_run_at !== undefined) asignar('next_run_at', valores.next_run_at);

    if (campos.length === 0) return null;

    params.push(id);
    const { rows } = await db.query(
        `UPDATE report_schedules
            SET ${campos.join(', ')}, updated_at = now()
          WHERE id = $${params.length}
          RETURNING *`,
        params
    );
    return rows[0] || null;
}

// ---------------------------------------------------------------------
// Historico
// ---------------------------------------------------------------------

/**
 * Historico de generaciones (mockup 2).
 *
 * `incluirDetalleTecnico` decide si la fila lleva el error real o el mensaje
 * generico. Criterio tecnico 5: RH, seguridad y gerencia ven "el reporte no
 * pudo generarse, ya fue notificado el equipo tecnico"; el detalle es solo
 * para quien puede hacer algo con el.
 */
async function listarHistorico({ scheduleId = null, limite = 50, incluirDetalleTecnico = false } = {}) {
    const params = [];
    let where = '';

    if (scheduleId) {
        params.push(scheduleId);
        where = `WHERE h.schedule_id = $${params.length}`;
    }

    params.push(limite);

    const { rows } = await db.query(
        `SELECT h.id, h.schedule_id, h.type, h.period, h.params_used, h.status,
                h.file_location, h.row_count, h.generated_at, h.duration_ms,
                h.error_summary, h.log_reference,
                s.name AS schedule_name, s.frequency
           FROM report_history h
           LEFT JOIN report_schedules s ON s.id = h.schedule_id
           ${where}
          ORDER BY h.generated_at DESC, h.id DESC
          LIMIT $${params.length}`,
        params
    );

    return rows.map(fila => {
        const base = {
            id: fila.id,
            schedule_id: fila.schedule_id,
            schedule_name: fila.schedule_name,
            frequency: fila.frequency,
            type: fila.type,
            period: fila.period,
            params_used: fila.params_used,
            status: fila.status,
            registros: fila.row_count,
            duracion_ms: fila.duration_ms,
            generated_at: fila.generated_at,
            // El enlace solo existe si hay archivo. La ruta en disco no sale
            // nunca: el cliente descarga por id.
            descarga: fila.status === 'success' && fila.file_location
                ? `/api/gamification/reports/history/${fila.id}/download`
                : null
        };

        if (fila.status !== 'error') return base;

        return {
            ...base,
            mensaje: 'El reporte no pudo generarse. El equipo tecnico ya fue notificado.',
            ...(incluirDetalleTecnico
                ? { detalle_tecnico: fila.error_summary, referencia_log: fila.log_reference }
                : {})
        };
    });
}

/**
 * Ruta en disco de un reporte generado, o null.
 *
 * Se resuelve con basename contra el directorio de reportes: aunque alguien
 * lograra escribir "../../etc/passwd" en file_location, la descarga seguiria
 * saliendo de storage/reports.
 */
async function obtenerArchivo(historyId) {
    const { rows } = await db.query(
        `SELECT id, file_location, status, type, period FROM report_history WHERE id = $1`,
        [historyId]
    );

    const fila = rows[0];
    if (!fila || fila.status !== 'success' || !fila.file_location) return null;

    const nombre = path.basename(fila.file_location);
    const ruta = path.join(DIR_REPORTES, nombre);

    return fs.existsSync(ruta) ? { ruta, nombre, ...fila } : null;
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

/**
 * Una vuelta del scheduler: dispara lo vencido y mueve la cola de avisos.
 *
 * Los avisos se procesan aca ademas de en el handler del evento porque los
 * reintentos no tienen quien los despierte: el primer intento lo dispara el
 * evento, los siguientes dependen de que alguien vuelva a mirar la cola.
 */
async function ejecutarCiclo(ahora = new Date()) {
    const encolados = await dispararProgramacionesVencidas(ahora);
    const avisos = await procesarNotificacionesPendientes();
    return { encolados: encolados.length, avisos };
}

function iniciarScheduler(intervaloMs = INTERVALO_SCHEDULER_MS) {
    if (temporizador) return;

    temporizador = setInterval(
        () => ejecutarCiclo().catch(e => console.error('[reportes-auto] scheduler:', e.message)),
        intervaloMs
    );
    if (temporizador.unref) temporizador.unref();

    console.log(`[reportes-auto] scheduler cada ${intervaloMs / 1000} s`);
}

function detenerScheduler() {
    if (temporizador) { clearInterval(temporizador); temporizador = null; }
}

/** Conecta el servicio al bus. */
function registrarHandlers() {
    eventBus.subscribe(EVENTOS.REPORT_SCHEDULED_RUN, p => generarReporteProgramado(p));
    eventBus.subscribe(EVENTOS.REPORT_AUTO_GENERATED, p => avisarReporteListo(p));
    console.log('[scheduledReports.service] handlers registrados');
}

module.exports = {
    TIPOS,
    FRECUENCIAS,
    FORMATOS,
    ROLES,
    ROLES_TECNICOS,
    MAX_INTENTOS_AVISO,
    BACKOFF_BASE_SEGUNDOS,
    DIR_REPORTES,
    semanaISO,
    calcularPeriodo,
    calcularProximaEjecucion,
    dispararUna,
    dispararProgramacionesVencidas,
    generarArchivo,
    generarReporteProgramado,
    registrarFallo,
    encolarAvisos,
    construirAviso,
    procesarNotificacionesPendientes,
    avisarReporteListo,
    validarProgramacion,
    listarProgramaciones,
    crearProgramacion,
    actualizarProgramacion,
    listarHistorico,
    obtenerArchivo,
    ejecutarCiclo,
    iniciarScheduler,
    detenerScheduler,
    registrarHandlers
};
