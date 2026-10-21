/**
 * Repositorio de la bandeja de notificaciones (servicio de notificaciones).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): la tabla
 * notifications (avisos in-app y estado de su correo).
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

async function insertar(userId, eventName, aviso) {
    const { rows } = await db.query(
        `INSERT INTO notifications (user_id, event_name, title, body, payload, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id, user_id, title, body, created_at`,
        [userId, eventName, aviso.title, aviso.body,
         JSON.stringify(aviso.payload || {}), aviso.dedupeKey]
    );
    return rows;
}

/** El correo del aviso salio. */
async function marcarCorreoEnviado(notificacion) {
    return db.query(
            `UPDATE notifications SET email_status = 'sent' WHERE id = $1`,
            [notificacion.id]
        );
}

/** Aviso por id o por dedupe_key, para reintentar su correo. */
async function buscarParaReenvio(id, dedupeKey) {
    const { rows } = await db.query(
        `SELECT id, user_id, title, body, email_status
           FROM notifications
          WHERE ($1::bigint IS NOT NULL AND id = $1::bigint)
             OR ($2::text   IS NOT NULL AND dedupe_key = $2::text)
          LIMIT 1`,
        [id, dedupeKey]
    );
    return rows;
}

/** El reintento del correo salio: limpia el error anterior. */
async function marcarCorreoReenviado(notificacion) {
    return db.query(
            `UPDATE notifications SET email_status = 'sent', email_error = NULL WHERE id = $1`,
            [notificacion.id]
        );
}

async function marcarCorreoFallido(err, notificacion) {
    return db.query(
            `UPDATE notifications SET email_status = 'failed', email_error = $1 WHERE id = $2`,
            [String(err.message).slice(0, 500), notificacion.id]
        );
}

/** Avisos del usuario, los mas recientes primero. */
async function bandejaDe(userId, soloNoLeidas, limit) {
    const { rows } = await db.query(
        `SELECT id, event_name, title, body, payload, email_status, read_at, created_at
           FROM notifications
          WHERE user_id = $1
            AND ($2::boolean = false OR read_at IS NULL)
          ORDER BY created_at DESC, id DESC
          LIMIT $3`,
        [userId, soloNoLeidas, limit]
    );
    return rows;
}

/** Cantidad de avisos sin leer. */
async function contarNoLeidas(userId) {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS no_leidas
           FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
    );
    return rows;
}

/** Marca un aviso propio como leido (solo si no lo estaba). */
async function marcarLeida(notificationId, userId) {
    const { rows } = await db.query(
        `UPDATE notifications
            SET read_at = now()
          WHERE id = $1 AND user_id = $2 AND read_at IS NULL
          RETURNING id, read_at`,
        [notificationId, userId]
    );
    return rows;
}

module.exports = {
    insertar,
    marcarCorreoEnviado,
    buscarParaReenvio,
    marcarCorreoReenviado,
    marcarCorreoFallido,
    bandejaDe,
    contarNoLeidas,
    marcarLeida
};
