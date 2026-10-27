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
const config = require('../config/configuracion');
const path = require('path');
const crypto = require('crypto');

const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const reportsService = require('./reports.service');
const exportsService = require('./reportExports.service');
const orgReportsService = require('./orgReports.service');
// Los avisos (bandeja y correo) los entrega notificaciones por su contrato.
const notificaciones = require('../infrastructure/client/notificaciones.cliente');

/** Cada cuanto revisa el scheduler si vencio alguna programacion. */
const INTERVALO_SCHEDULER_MS =
    config.segundosEntreRevisionesDelScheduler * 1000;

/**
 * Base del backoff de los avisos, en segundos. La espera es base * 2^intento:
 * 2, 4 y 8 minutos con el valor por defecto.
 */
const BACKOFF_BASE_SEGUNDOS = config.segundosBaseDeReintentoDeAvisos;

/** Criterio tecnico 4: tres intentos y despues se marca fallido. */
const MAX_INTENTOS_AVISO = 3;

/**
 * A quien se le avisa cuando la generacion falla (criterio de aceptacion 3).
 *
 * No hay un rol 'soporte' en el sistema, asi que el equipo tecnico son los
 * administradores. Queda configurable para el dia que exista uno.
 */
const ROLES_TECNICOS = config.rolesTecnicos;

/** Donde quedan los archivos generados. Fuera del control de versiones. */
const { DIR_STORAGE } = require('../../../compartido/config/rutas');
const { conTransaccion } = require('../../../compartido/config/transaccion');
const { TIPOS, FRECUENCIAS, FORMATOS, semanaISO, calcularPeriodo, calcularProximaEjecucion } = require('../domain/programacion');
const repo = require('../infrastructure/persistence/programados.repositorio');
const identidad = require('../infrastructure/client/identidad.cliente');
const DIR_REPORTES = path.join(DIR_STORAGE, 'reports');

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
    return conTransaccion(async (tx) => {
        const programacion = await repo.bloquearVencida(ahora, tx);
        if (!programacion) return null;

        const periodo = calcularPeriodo(programacion.frequency, ahora);
        const proxima = calcularProximaEjecucion(
            programacion.frequency, programacion.next_run_at, ahora
        );

        // Criterio tecnico 1: "debo actualizar next_run_at segun la frecuencia
        // configurada INMEDIATAMENTE al encolar, para evitar disparos
        // duplicados". Va antes del publish, en la misma transaccion.
        await repo.adelantar(programacion.id, proxima, ahora, tx);

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

        await eventBus.publish(EVENTOS.REPORT_SCHEDULED_RUN, payload, tx);

        console.log(
            `[reportes-auto] encolado schedule=${programacion.id} periodo=${periodo.clave} ` +
            `proxima=${proxima.toISOString()}`
        );

        return payload;
    });
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
    const previos = await repo.exitoDelPeriodo(scheduleId, periodo);

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
        const rows = await repo.registrarExito(scheduleId, tipo, periodo, params, fileName, filas, arranque);

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

    const rows = await repo.registrarFallo(scheduleId, tipo, periodo, params, resumen, referencia, arranque);

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
        : (await repo.rolesSuscritos(historyId)).rows[0]?.roles || [];

    if (!roles || roles.length === 0) {
        console.warn(`[reportes-auto] history=${historyId} sin roles suscritos: no hay a quien avisar`);
        return [];
    }

    // Las cuentas son de identidad (otra base): se piden los destinatarios por
    // su contrato y se encola un aviso por cada uno.
    const destinatarios = await identidad.activosConRoles(roles);
    if (destinatarios.length === 0) return [];

    return repo.encolarAvisos(historyId, kind, MAX_INTENTOS_AVISO, destinatarios);
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
    await notificaciones.notificar(evento, aviso, fila.user_id);

    const estado = await notificaciones.reenviarCorreo({ dedupeKey: aviso.dedupeKey });

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
    const rows = await repo.avisosPendientes(limite);

    let entregados = 0, fallidos = 0;

    for (const fila of rows) {
        try {
            await entregarAviso(fila);
            await repo.marcarAvisoEnviado(fila);
            entregados++;

        } catch (err) {
            const intentos = fila.attempts + 1;
            const agotado = intentos >= fila.max_attempts;
            const espera = BACKOFF_BASE_SEGUNDOS * Math.pow(2, intentos);
            const estado = agotado ? 'failed' : 'pending';
            const error = String(err.message).slice(0, 500);

            await repo.reprogramarAviso(fila, estado, intentos, error, espera);

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
    const rows = await repo.listarProgramaciones();
    return rows;
}

/**
 * Una programacion por id, tal como esta guardada. La usa el log de
 * auditoria para dejar el valor anterior de una edicion.
 */
async function obtenerProgramacion(id) {
    const rows = await repo.buscarProgramacion(id);
    return rows[0] || null;
}

async function crearProgramacion(valores, userId) {
    const rows = await repo.insertarProgramacion(valores, userId);
    return rows[0];
}

/**
 * Actualiza una programacion.
 *
 * Solo escribe los campos que vinieron: un PATCH que manda la frecuencia no
 * puede borrar los roles suscritos por omision.
 */
async function actualizarProgramacion(id, valores) {
    return repo.actualizarProgramacion(id, valores);
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
    const rows = await repo.historico({ scheduleId, limite });

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
    const rows = await repo.generacionDe(historyId);

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
    obtenerProgramacion,
    crearProgramacion,
    actualizarProgramacion,
    listarHistorico,
    obtenerArchivo,
    ejecutarCiclo,
    iniciarScheduler,
    detenerScheduler,
    registrarHandlers
};
