/**
 * Repositorio de auditoria de ajustes manuales (servicio de seguridad).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): la tabla
 * audit_log, inmutable. Las funciones que participan de una transaccion
 * reciben `tx`; sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/** Escribe una entrada de auditoria. previous_value y new_value se guardan como JSON. */
async function insertar({ actorId, targetUserId, changeType, previousValue, newValue, reason }, tx) {
    const { rows } = await q(tx).query(
        `INSERT INTO audit_log
            (actor_id, target_user_id, change_type, previous_value, new_value, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, actor_id, target_user_id, change_type, reason, created_at`,
        [actorId, targetUserId, changeType,
         previousValue === null ? null : JSON.stringify(previousValue),
         newValue === null ? null : JSON.stringify(newValue),
         reason]
    );
    return rows[0];
}

/** WHERE del log segun los filtros (todos opcionales). */
function filtroDeAuditoria({ actorId = null, targetUserId = null, changeType = null }) {
    const condiciones = [];
    const params = [];

    if (actorId)      { params.push(actorId);      condiciones.push(`l.actor_id = $${params.length}`); }
    if (targetUserId) { params.push(targetUserId); condiciones.push(`l.target_user_id = $${params.length}`); }
    if (changeType)   { params.push(changeType);   condiciones.push(`l.change_type = $${params.length}`); }

    return { where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '', params };
}

async function contar(filtros) {
    const { where, params } = filtroDeAuditoria(filtros);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS total FROM audit_log l ${where}`, params);
    return rows[0].total;
}

/** Pagina del log, de lo mas reciente a lo mas antiguo, con los correos de actor y objetivo. */
async function pagina(filtros, { limit, offset }) {
    const { where, params } = filtroDeAuditoria(filtros);
    const { rows } = await db.query(
        `SELECT l.id, l.change_type, l.previous_value, l.new_value, l.reason, l.created_at,
                l.actor_id,  a.email AS actor_email,
                l.target_user_id, t.email AS target_email
           FROM audit_log l
           JOIN users a ON a.id = l.actor_id
           LEFT JOIN users t ON t.id = l.target_user_id
           ${where}
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
    );
    return rows;
}

module.exports = { insertar, contar, pagina };
