/**
 * Repositorio de anomalias (servicio de seguridad).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): reglas,
 * eventos de anomalia y su historial de estados. Lee points_ledger, users y
 * audit_log (declarado en el manifiesto).
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/** WHERE del listado de anomalias segun los filtros (todos opcionales). */
function filtroDeAnomalias({ status = null, severity = null, userId = null }) {
    const condiciones = [];
    const params = [];

    if (status)   { params.push(status);   condiciones.push(`a.status = $${params.length}`); }
    if (severity) { params.push(severity); condiciones.push(`a.severity = $${params.length}`); }
    if (userId)   { params.push(userId);   condiciones.push(`a.user_id = $${params.length}`); }

    return { where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '', params };
}

async function contarAnomalias(filtros) {
    const { where, params } = filtroDeAnomalias(filtros);
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total FROM anomaly_events a ${where}`, params
    );
    return rows[0].total;
}

/** Pagina del listado: lo grave y sin revisar primero. */
async function paginaDeAnomalias(filtros, { limit, offset }) {
    const { where, params } = filtroDeAnomalias(filtros);
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
        [...params, limit, offset]
    );
    return rows;
}

/** Lee y bloquea (FOR UPDATE) una anomalia. */
async function bloquearAnomalia(id, tx) {
    const { rows } = await q(tx).query('SELECT id, status FROM anomaly_events WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] || null;
}

async function actualizarEstado(id, nuevoEstado, tx) {
    const { rows } = await q(tx).query(
        `UPDATE anomaly_events SET status = $2 WHERE id = $1
         RETURNING id, status`,
        [id, nuevoEstado]
    );
    return rows[0];
}

/** Historial de cambios de estado (va en la misma transaccion que el UPDATE). */
async function registrarCambioDeEstado({ anomalyId, anterior, nuevoEstado, userId, nota }, tx) {
    await q(tx).query(
        `INSERT INTO anomaly_status_history
            (anomaly_id, previous_status, new_status, changed_by, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [anomalyId, anterior, nuevoEstado, userId, nota]
    );
}
/** Reglas de deteccion activas. */
async function reglasActivas() {
    const { rows } = await db.query(
        `SELECT code, description, rule_type, window_minutes, max_points, severity
           FROM anomaly_rules
          WHERE is_active = true
          ORDER BY max_points DESC`
    );
    return rows;
}

/** Movimientos de puntos del usuario dentro de la ventana que termina en `hasta` (o ahora). */
async function movimientosEnVentana(userId, ventanaMinutos, hasta) {
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

/** Registra una anomalia. Idempotente por dedupe_key. */
async function insertarAnomalia(userId, regla, evidencia, disparadorId, dedupeKey) {
    const { rows } = await db.query(
        `INSERT INTO anomaly_events
            (user_id, rule_triggered, evidence, severity, source_id, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id, user_id, rule_triggered, severity, status, detected_at`,
        [userId, regla.code, JSON.stringify(evidencia), regla.severity,
         String(disparadorId), dedupeKey]
    );
    return rows;
}

/** Usuarios con movimientos de puntos en los ultimos N minutos. */
async function usuariosConMovimientosRecientes(lookback) {
    const { rows } = await db.query(
        `SELECT DISTINCT user_id
           FROM points_ledger
          WHERE created_at > now() - ($1 || ' minutes')::interval`,
        [String(lookback)]
    );
    return rows;
}

/** Cantidad de anomalias por estado y severidad. */
async function resumenPorEstadoYSeveridad() {
    const { rows } = await db.query(
        `SELECT status, severity, COUNT(*)::int AS total
           FROM anomaly_events GROUP BY status, severity`
    );
    return rows;
}

/** Anomalia con el usuario y la regla que la disparo. */
async function buscarAnomalia(id) {
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
    return rows;
}

/** Cambios de estado de la anomalia, del mas reciente al mas antiguo. */
async function historialDeEstados(id) {
    return db.query(
            `SELECT h.previous_status, h.new_status, h.note, h.changed_at,
                    u.email AS changed_by_email
               FROM anomaly_status_history h
               JOIN users u ON u.id = h.changed_by
              WHERE h.anomaly_id = $1
              ORDER BY h.changed_at DESC`,
            [id]
        );
}

/** Ultimos 50 movimientos de puntos del usuario. */
async function lineaDeTiempo(afectadoId) {
    return db.query(
            `SELECT id, source_type, source_id, points, rule_code, created_at
               FROM points_ledger
              WHERE user_id = $1
              ORDER BY created_at DESC
              LIMIT 50`,
            [afectadoId]
        );
}

/** Ultimos 20 ajustes manuales sobre el usuario (audit_log). */
async function ajustesManuales(afectadoId) {
    return db.query(
            `SELECT l.change_type, l.previous_value, l.new_value, l.reason,
                    l.created_at, a.email AS actor_email
               FROM audit_log l
               JOIN users a ON a.id = l.actor_id
              WHERE l.target_user_id = $1
              ORDER BY l.created_at DESC
              LIMIT 20`,
            [afectadoId]
        );
}

module.exports = {
    contarAnomalias,
    paginaDeAnomalias,
    bloquearAnomalia,
    actualizarEstado,
    registrarCambioDeEstado,
    reglasActivas,
    movimientosEnVentana,
    insertarAnomalia,
    usuariosConMovimientosRecientes,
    resumenPorEstadoYSeveridad,
    buscarAnomalia,
    historialDeEstados,
    lineaDeTiempo,
    ajustesManuales
};
