/**
 * Repositorio de reportes programados (servicio de reportes).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material):
 * programaciones (report_schedules), historial de generaciones
 * (report_history) y avisos (report_notifications).
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/**
 * Bloquea la programacion vencida mas antigua (FOR UPDATE SKIP LOCKED: dos
 * instancias del scheduler no toman la misma). null si no hay ninguna.
 */
async function bloquearVencida(ahora, tx) {
    const { rows } = await q(tx).query(
        `SELECT id, name, report_type, frequency, format, params, next_run_at
           FROM reportes.report_schedules
          WHERE is_active = true AND next_run_at <= $1::timestamptz
          ORDER BY next_run_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [ahora.toISOString()]
    );
    return rows[0] || null;
}

/** Adelanta next_run_at y marca last_run_at, en la misma transaccion que el encolado. */
async function adelantar(id, proxima, ahora, tx) {
    await q(tx).query(
        `UPDATE reportes.report_schedules
            SET next_run_at = $2, last_run_at = $3, updated_at = now()
          WHERE id = $1`,
        [id, proxima.toISOString(), ahora.toISOString()]
    );
}

/**
 * Actualiza solo los campos que vinieron: un PATCH que manda la frecuencia no
 * puede borrar los roles suscritos por omision. Devuelve la fila o null.
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
        `UPDATE reportes.report_schedules
            SET ${campos.join(', ')}, updated_at = now()
          WHERE id = $${params.length}
          RETURNING *`,
        params
    );
    return rows[0] || null;
}

/** Historico de generaciones, con el nombre y la frecuencia de su programacion. */
async function historico({ scheduleId = null, limite = 50 } = {}) {
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
           FROM reportes.report_history h
           LEFT JOIN reportes.report_schedules s ON s.id = h.schedule_id
           ${where}
          ORDER BY h.generated_at DESC, h.id DESC
          LIMIT $${params.length}`,
        params
    );

    return rows;
}
/** Generacion exitosa ya registrada para esa programacion y periodo (idempotencia). */
async function exitoDelPeriodo(scheduleId, periodo) {
    const { rows } = await db.query(
        `SELECT id, status FROM reportes.report_history
          WHERE schedule_id = $1 AND period = $2 AND status = 'success'`,
        [scheduleId, periodo]
    );
    return rows;
}

/** Historial: generacion exitosa con su archivo. */
async function registrarExito(scheduleId, tipo, periodo, params, fileName, filas, arranque) {
    const { rows } = await db.query(
            `INSERT INTO reportes.report_history
                (schedule_id, type, period, params_used, status, file_location, row_count, duration_ms)
             VALUES ($1, $2, $3, $4, 'success', $5, $6, $7)
             ON CONFLICT (schedule_id, period) WHERE status = 'success' DO NOTHING
             RETURNING id, schedule_id, type, period, status, file_location, generated_at`,
            [scheduleId, tipo, periodo, JSON.stringify(params || {}),
             `storage/reports/${fileName}`, filas, Date.now() - arranque]
        );
    return rows;
}

/** Historial: generacion fallida con resumen y referencia al log. */
async function registrarFallo(scheduleId, tipo, periodo, params, resumen, referencia, arranque) {
    const { rows } = await db.query(
        `INSERT INTO reportes.report_history
            (schedule_id, type, period, params_used, status, error_summary, log_reference, duration_ms)
         VALUES ($1, $2, $3, $4, 'error', $5, $6, $7)
         RETURNING id, schedule_id, type, period, status, generated_at`,
        [scheduleId, tipo, periodo, JSON.stringify(params || {}),
         resumen, referencia, Date.now() - (arranque || Date.now())]
    );
    return rows;
}

/** Roles suscritos a la programacion de esa generacion. */
async function rolesSuscritos(historyId) {
    return db.query(
            `SELECT COALESCE(s.subscriber_roles, ARRAY[]::text[]) AS roles
               FROM reportes.report_history h
               LEFT JOIN reportes.report_schedules s ON s.id = h.schedule_id
              WHERE h.id = $1`,
            [historyId]
          );
}

/** Un aviso por destinatario (los ids los da el contrato de identidad). Sin duplicados. */
async function encolarAvisos(historyId, kind, maxIntentos, userIds) {
    const { rows } = await db.query(
        `INSERT INTO reportes.report_notifications (history_id, user_id, kind, max_attempts)
         SELECT $1, destinatario, $2, $3
           FROM unnest($4::int[]) AS destinatario
         ON CONFLICT (history_id, user_id) DO NOTHING
         RETURNING id, user_id`,
        [historyId, kind, maxIntentos, userIds]
    );
    return rows;
}

/** Avisos vencidos, con los datos de su generacion. */
async function avisosPendientes(limite) {
    const { rows } = await db.query(
        `SELECT n.id, n.history_id, n.user_id, n.kind, n.attempts, n.max_attempts,
                h.type, h.period, h.status, h.error_summary, h.log_reference,
                h.schedule_id, h.generated_at,
                s.name AS schedule_name
           FROM reportes.report_notifications n
           JOIN reportes.report_history h ON h.id = n.history_id
           LEFT JOIN reportes.report_schedules s ON s.id = h.schedule_id
          WHERE n.status = 'pending' AND n.next_attempt_at <= now()
          ORDER BY n.next_attempt_at
          LIMIT $1`,
        [limite]
    );
    return rows;
}

/** Aviso entregado. */
async function marcarAvisoEnviado(fila) {
    return db.query(
                `UPDATE reportes.report_notifications
                    SET status = 'sent', attempts = attempts + 1, sent_at = now(), last_error = NULL
                  WHERE id = $1`,
                [fila.id]
            );
}

/** Aviso fallido: reintento con backoff o 'failed' si se agoto. */
async function reprogramarAviso(fila, estado, intentos, error, espera) {
    return db.query(
                `UPDATE reportes.report_notifications
                    SET status = $2,
                        attempts = $3,
                        last_error = $4,
                        next_attempt_at = now() + ($5 || ' seconds')::interval
                  WHERE id = $1`,
                [fila.id, estado, intentos, error, String(espera)]
            );
}

/** Programaciones con su ultima generacion. */
async function listarProgramaciones() {
    const { rows } = await db.query(
        `SELECT s.id, s.name, s.report_type, s.frequency, s.format, s.params,
                s.subscriber_roles, s.is_active, s.next_run_at, s.last_run_at,
                s.created_at, s.updated_at,
                (SELECT COUNT(*)::int FROM reportes.report_history h WHERE h.schedule_id = s.id) AS generados,
                (SELECT MAX(h.generated_at) FROM reportes.report_history h
                  WHERE h.schedule_id = s.id AND h.status = 'success') AS ultimo_exitoso
           FROM reportes.report_schedules s
          ORDER BY s.is_active DESC, s.next_run_at`
    );
    return rows;
}

/** Programacion por id. */
async function buscarProgramacion(id) {
    const { rows } = await db.query(
        `SELECT id, name, report_type, frequency, format, params,
                subscriber_roles, is_active, next_run_at
           FROM reportes.report_schedules
          WHERE id = $1`,
        [id]
    );
    return rows;
}

/** Alta de una programacion. */
async function insertarProgramacion(valores, userId) {
    const { rows } = await db.query(
        `INSERT INTO reportes.report_schedules
            (name, report_type, frequency, format, params, subscriber_roles, next_run_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8)
         RETURNING *`,
        [valores.name, valores.report_type, valores.frequency, valores.format || 'csv',
         JSON.stringify(valores.params || {}), valores.subscriber_roles,
         valores.next_run_at || null, userId]
    );
    return rows;
}

/** Generacion del historial (para descargar su archivo). */
async function generacionDe(historyId) {
    const { rows } = await db.query(
        `SELECT id, file_location, status, type, period FROM reportes.report_history WHERE id = $1`,
        [historyId]
    );
    return rows;
}

module.exports = {
    bloquearVencida,
    adelantar,
    actualizarProgramacion,
    historico,
    exitoDelPeriodo,
    registrarExito,
    registrarFallo,
    rolesSuscritos,
    encolarAvisos,
    avisosPendientes,
    marcarAvisoEnviado,
    reprogramarAviso,
    listarProgramaciones,
    buscarProgramacion,
    insertarProgramacion,
    generacionDe
};
