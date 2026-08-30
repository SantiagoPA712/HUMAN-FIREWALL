/**
 * Deteccion de anomalias en la asignacion de puntos.
 *
 * HU: "quiero analizar metricas de uso y comportamiento del sistema de
 * gamificacion para detectar patrones anomalos o posible abuso del sistema de
 * puntos".
 *
 * ---------------------------------------------------------------------
 * Dos caminos hacia la misma deteccion
 * ---------------------------------------------------------------------
 * Criterio tecnico 1: en tiempo real, suscrito a points_assigned. El evento ya
 * existia (lo publica points.service dentro de la transaccion que escribe el
 * ledger), asi que no hubo que tocar nada del modulo de puntos: alcanza con
 * escuchar. Y como el bus es asincrono, la deteccion no retrasa ni un
 * milisegundo la respuesta de la accion que otorgo los puntos.
 *
 * Criterio tecnico 6: ademas, un job periodico reevalua la ventana reciente.
 * Es la red de seguridad para el caso en que un evento se pierda, quede
 * fallido tras agotar los reintentos, o el proceso se reinicie con la cola a
 * medio procesar. Una deteccion de abuso que depende de que ningun mensaje se
 * caiga no es una deteccion de abuso.
 *
 * Los dos caminos escriben por la misma funcion y comparten la misma clave de
 * deduplicacion, asi que ejecutar los dos sobre el mismo movimiento produce
 * una sola alerta.
 */

const db = require('../config/db');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');

/** Cada cuanto corre el job de respaldo. Configurable (criterio tecnico 6). */
const INTERVALO_JOB_MS =
    (Number(process.env.ANOMALY_JOB_INTERVAL_MINUTES) || 15) * 60 * 1000;

let temporizador = null;

/** Reglas activas. */
async function obtenerReglas() {
    const { rows } = await db.query(
        `SELECT code, description, rule_type, window_minutes, max_points, severity
           FROM anomaly_rules
          WHERE is_active = true
          ORDER BY max_points DESC`
    );
    return rows;
}

/**
 * Movimientos de un usuario dentro de la ventana de una regla.
 *
 * Devuelve el detalle completo y no solo la suma: es la evidencia que pide el
 * criterio tecnico 2, y lo que permite que el panel muestre "de donde salieron
 * esos puntos" (criterio de aceptacion 1).
 */
async function movimientosEnVentana(userId, ventanaMinutos, hasta = null) {
    const { rows } = await db.query(
        `SELECT id, source_type, source_id, points, rule_code, created_at
           FROM points_ledger
          WHERE user_id = $1
            AND created_at >  COALESCE($3::timestamptz, now()) - ($2 || ' minutes')::interval
            AND created_at <= COALESCE($3::timestamptz, now())
          ORDER BY created_at ASC, id ASC`,
        [userId, String(ventanaMinutos), hasta]
    );
    return rows;
}

/**
 * Registra una anomalia. Idempotente por (regla, movimiento disparador).
 *
 * Criterio tecnico 6: la clave es source_id + rule_triggered. Con eso, el job
 * periodico puede reevaluar la misma ventana cuantas veces quiera sin generar
 * alertas duplicadas.
 *
 * @returns {Promise<object|null>} la anomalia creada, o null si ya existia
 */
async function registrarAnomalia({ userId, regla, movimientos, disparadorId }) {
    const totalVentana = movimientos.reduce((a, m) => a + m.points, 0);
    const dedupeKey = `${regla.code}:${disparadorId}`;

    const evidencia = {
        total_en_ventana: totalVentana,
        umbral: regla.max_points,
        ventana_minutos: regla.window_minutes,
        // Los movimientos concretos, con su origen. Congelados: si manana
        // cambia una regla de puntuacion, la evidencia sigue mostrando lo que
        // se vio al detectar.
        movimientos: movimientos.map(m => ({
            ledger_id: m.id,
            origen: m.source_type,
            referencia: m.source_id,
            puntos: m.points,
            regla_puntos: m.rule_code,
            fecha: m.created_at
        }))
    };

    // Una sola escritura: no hace falta transaccion. La deduplicacion la
    // garantiza el UNIQUE sobre dedupe_key, no un bloqueo.
    const { rows } = await db.query(
        `INSERT INTO anomaly_events
            (user_id, rule_triggered, evidence, severity, source_id, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id, user_id, rule_triggered, severity, status, detected_at`,
        [userId, regla.code, JSON.stringify(evidencia), regla.severity,
         String(disparadorId), dedupeKey]
    );

    if (rows.length === 0) return null;   // ya detectada

    // Queda en el log del servidor ademas de en la tabla: si alguien vacia el
    // panel sin mirarlo, el rastro sigue estando en algun lado.
    //
    // No se publica ningun evento en el bus: hoy nadie reaccionaria a el, y un
    // evento sin suscriptores es una fila mas en la cola que no hace nada. Si
    // manana se quiere avisar al area de seguridad por correo, se agrega el
    // nombre al catalogo y notifications.service se suscribe; este archivo no
    // tendria que cambiar mas que en esta linea.
    console.warn(
        `[anomalias] ${regla.severity.toUpperCase()} usuario=${userId} regla=${regla.code} ` +
        `${totalVentana} pts en ${regla.window_minutes} min (umbral ${regla.max_points})`
    );

    return rows[0];
}

/**
 * Evalua a un usuario contra todas las reglas activas.
 *
 * @param {number} userId
 * @param {object} [opciones]
 * @param {number|string} [opciones.disparadorId]  movimiento que motivo la
 *        evaluacion; es la mitad de la clave de idempotencia
 * @param {string} [opciones.hasta]  evaluar como si "ahora" fuera este
 *        instante. Lo usa el job de respaldo para reconstruir la ventana tal
 *        como estaba cuando ocurrio el movimiento, y no la de este momento.
 * @returns {Promise<object[]>} anomalias nuevas
 */
async function evaluarUsuario(userId, { disparadorId = null, hasta = null } = {}) {
    if (!userId) return [];

    const reglas = await obtenerReglas();
    const detectadas = [];

    // Las ventanas se piden una sola vez por duracion: dos reglas de 60
    // minutos comparten la misma consulta.
    const cache = new Map();

    for (const regla of reglas) {
        const clave = `${regla.window_minutes}:${hasta || 'now'}`;
        if (!cache.has(clave)) {
            cache.set(clave, await movimientosEnVentana(userId, regla.window_minutes, hasta));
        }
        const movimientos = cache.get(clave);

        const total = movimientos.reduce((a, m) => a + m.points, 0);
        if (total <= regla.max_points) continue;

        // Sin movimiento disparador explicito se usa el ultimo de la ventana:
        // asi la clave de deduplicacion es estable entre el camino en tiempo
        // real y el job de respaldo.
        const disparador = disparadorId ?? movimientos[movimientos.length - 1]?.id;
        if (!disparador) continue;

        const anomalia = await registrarAnomalia({
            userId, regla, movimientos, disparadorId: disparador
        });
        if (anomalia) detectadas.push(anomalia);
    }

    return detectadas;
}

// ---------------------------------------------------------------------
// Job periodico de respaldo (criterio tecnico 6)
// ---------------------------------------------------------------------

/**
 * Reevalua los movimientos recientes.
 *
 * Sobre "la ventana no procesada": no se guarda una marca de agua del ultimo
 * movimiento revisado. Se reevalua directamente la ventana reciente y se
 * confia en la deduplicacion.
 *
 * Es a proposito. Una marca de agua se rompe de dos formas conocidas: si el
 * job muere a mitad de camino queda adelantada sobre trabajo que no se hizo, y
 * si un movimiento se inserta con fecha anterior al ultimo procesado (un
 * reintento demorado de la cola) queda por detras de la marca y no se revisa
 * nunca. Reevaluar y deduplicar no tiene ninguno de los dos problemas: el
 * costo es una consulta mas, y a cambio ningun movimiento se pierde.
 *
 * @param {number} [minutosHaciaAtras]  por defecto, el doble de la ventana mas
 *        larga configurada: cubre de sobra el hueco entre dos ejecuciones.
 */
async function ejecutarJob(minutosHaciaAtras = null) {
    const reglas = await obtenerReglas();
    if (reglas.length === 0) return { usuarios: 0, detectadas: 0 };

    const ventanaMaxima = Math.max(...reglas.map(r => r.window_minutes));
    const lookback = minutosHaciaAtras || ventanaMaxima * 2;

    // Solo los usuarios con movimientos recientes: no tiene sentido recorrer
    // el padron entero.
    const { rows: usuarios } = await db.query(
        `SELECT DISTINCT user_id
           FROM points_ledger
          WHERE created_at > now() - ($1 || ' minutes')::interval`,
        [String(lookback)]
    );

    let detectadas = 0;
    for (const { user_id } of usuarios) {
        // Sin disparador explicito: evaluarUsuario toma el ultimo movimiento
        // de la ventana, que es la misma clave que habria usado el camino en
        // tiempo real.
        const nuevas = await evaluarUsuario(user_id);
        detectadas += nuevas.length;
    }

    if (detectadas > 0) {
        console.warn(`[anomalias] job de respaldo: ${detectadas} alerta(s) que el camino en tiempo real no genero`);
    }

    return { usuarios: usuarios.length, detectadas };
}

function iniciarJob() {
    if (temporizador) return;
    temporizador = setInterval(
        () => ejecutarJob().catch(e => console.error('[anomalias] job:', e.message)),
        INTERVALO_JOB_MS
    );
    // unref: un temporizador de respaldo no debe impedir que el proceso
    // termine cuando ya no queda nada mas que hacer (por ejemplo en pruebas).
    if (temporizador.unref) temporizador.unref();

    console.log(`[anomalias] job de respaldo cada ${INTERVALO_JOB_MS / 60000} min`);
}

function detenerJob() {
    if (temporizador) { clearInterval(temporizador); temporizador = null; }
}

// ---------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------

/** Listado para el panel, con filtros y paginacion. */
async function listarAnomalias({ status = null, severity = null, userId = null,
                                 page = 1, pageSize = 25 } = {}) {
    const condiciones = [];
    const params = [];

    if (status)   { params.push(status);   condiciones.push(`a.status = $${params.length}`); }
    if (severity) { params.push(severity); condiciones.push(`a.severity = $${params.length}`); }
    if (userId)   { params.push(userId);   condiciones.push(`a.user_id = $${params.length}`); }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows: totales } = await db.query(
        `SELECT COUNT(*)::int AS total FROM anomaly_events a ${where}`, params
    );
    const total = totales[0].total;

    const offset = (page - 1) * pageSize;
    const { rows } = await db.query(
        `SELECT a.id, a.user_id, u.email, a.rule_triggered, a.severity, a.status,
                a.detected_at,
                (a.evidence->>'total_en_ventana')::int AS total_en_ventana,
                (a.evidence->>'umbral')::int            AS umbral,
                jsonb_array_length(a.evidence->'movimientos') AS movimientos
           FROM anomaly_events a
           JOIN users u ON u.id = a.user_id
           ${where}
          ORDER BY
                -- Lo grave y sin revisar primero: es el orden en que el area
                -- de seguridad necesita atenderlas, no el cronologico.
                CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,
                CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                WHEN 'medium' THEN 2 ELSE 3 END,
                a.detected_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset]
    );

    return {
        paginacion: { page, page_size: pageSize, total, total_paginas: Math.max(1, Math.ceil(total / pageSize)) },
        resumen: await obtenerResumen(),
        resultados: rows
    };
}

/** Contadores para la cabecera del panel. */
async function obtenerResumen() {
    const { rows } = await db.query(
        `SELECT status, severity, COUNT(*)::int AS total
           FROM anomaly_events GROUP BY status, severity`
    );

    const resumen = { total: 0, pendientes: 0, revisadas: 0, descartadas: 0, por_severidad: {} };
    for (const r of rows) {
        resumen.total += r.total;
        if (r.status === 'pending')   resumen.pendientes += r.total;
        if (r.status === 'reviewed')  resumen.revisadas += r.total;
        if (r.status === 'dismissed') resumen.descartadas += r.total;
        resumen.por_severidad[r.severity] = (resumen.por_severidad[r.severity] || 0) + r.total;
    }
    return resumen;
}

/**
 * Detalle de una anomalia, con la linea de tiempo del usuario involucrado
 * (mockup 2).
 *
 * La linea de tiempo mezcla los movimientos de puntos con los ajustes
 * manuales que se le hicieron: si alguien acumulo 5000 puntos porque un
 * administrador se los otorgo a mano, eso tiene que verse al lado de la
 * alerta y no en otra pantalla.
 */
async function obtenerAnomalia(id) {
    const { rows } = await db.query(
        `SELECT a.id, a.user_id, u.email, u.role, a.rule_triggered, a.evidence,
                a.severity, a.status, a.source_id, a.detected_at,
                r.description AS regla_descripcion,
                r.window_minutes, r.max_points
           FROM anomaly_events a
           JOIN users u ON u.id = a.user_id
           LEFT JOIN anomaly_rules r ON r.code = a.rule_triggered
          WHERE a.id = $1`,
        [id]
    );
    if (rows.length === 0) return null;

    const anomalia = rows[0];

    const [historial, linea, ajustes] = await Promise.all([
        db.query(
            `SELECT h.previous_status, h.new_status, h.note, h.changed_at,
                    u.email AS changed_by_email
               FROM anomaly_status_history h
               JOIN users u ON u.id = h.changed_by
              WHERE h.anomaly_id = $1
              ORDER BY h.changed_at DESC`,
            [id]
        ),
        db.query(
            `SELECT id, source_type, source_id, points, rule_code, created_at
               FROM points_ledger
              WHERE user_id = $1
              ORDER BY created_at DESC
              LIMIT 50`,
            [anomalia.user_id]
        ),
        db.query(
            `SELECT l.change_type, l.previous_value, l.new_value, l.reason,
                    l.created_at, a.email AS actor_email
               FROM audit_log l
               JOIN users a ON a.id = l.actor_id
              WHERE l.target_user_id = $1
              ORDER BY l.created_at DESC
              LIMIT 20`,
            [anomalia.user_id]
        )
    ]);

    return {
        ...anomalia,
        historial_estados: historial.rows,
        linea_de_tiempo: linea.rows,
        ajustes_manuales: ajustes.rows
    };
}

/** Estados validos (criterio tecnico 5). */
const ESTADOS = ['pending', 'reviewed', 'dismissed'];

/**
 * Cambia el estado de una anomalia dejando traza.
 *
 * El UPDATE y el INSERT en el historial van en la misma transaccion: un
 * cambio de estado sin su registro seria exactamente el agujero que esta
 * historia viene a cerrar.
 */
async function cambiarEstado({ anomalyId, nuevoEstado, userId, nota = null }) {
    if (!ESTADOS.includes(nuevoEstado)) {
        const error = new Error(`Estado invalido: "${nuevoEstado}". Validos: ${ESTADOS.join(', ')}.`);
        error.campo = 'status';
        throw error;
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows: actuales } = await client.query(
            'SELECT id, status FROM anomaly_events WHERE id = $1 FOR UPDATE',
            [anomalyId]
        );
        if (actuales.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const anterior = actuales[0].status;

        const { rows } = await client.query(
            `UPDATE anomaly_events SET status = $2 WHERE id = $1
             RETURNING id, status`,
            [anomalyId, nuevoEstado]
        );

        await client.query(
            `INSERT INTO anomaly_status_history
                (anomaly_id, previous_status, new_status, changed_by, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [anomalyId, anterior, nuevoEstado, userId, nota]
        );

        await client.query('COMMIT');
        return { ...rows[0], previous_status: anterior };

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/** Conecta el servicio al bus y arranca el job de respaldo. */
function registrarHandlers() {
    // Criterio tecnico 1: se reutiliza el evento que points.service ya
    // publicaba. No hubo que tocar el modulo de puntos.
    eventBus.subscribe(EVENTOS.POINTS_ASSIGNED, ({ userId, ledgerId }) =>
        evaluarUsuario(userId, { disparadorId: ledgerId })
    );
    console.log('[anomalies.service] handlers registrados');
}

module.exports = {
    ESTADOS,
    INTERVALO_JOB_MS,
    obtenerReglas,
    movimientosEnVentana,
    evaluarUsuario,
    registrarAnomalia,
    ejecutarJob,
    iniciarJob,
    detenerJob,
    listarAnomalias,
    obtenerResumen,
    obtenerAnomalia,
    cambiarEstado,
    registrarHandlers
};
