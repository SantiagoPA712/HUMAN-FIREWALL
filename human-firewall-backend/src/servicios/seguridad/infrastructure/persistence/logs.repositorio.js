/**
 * Repositorio del registro de actividad (servicio de seguridad).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): data.logs y
 * data.logs_purges. El WHERE y el ORDER BY del listado se arman aca, a
 * partir de los filtros ya validados por application/. Las funciones que
 * participan de una transaccion reciben `tx`; sin `tx` usan el pool.
 */

const db = require('./conexion');

const q = (tx) => tx || db;

/**
 * WHERE compartido por listado, conteo y exportacion.
 * Todo va parametrizado: ningun valor del query se pega en el SQL.
 */
function construirWhere(filtros) {
    const condiciones = [];
    const params = [];
    const agregar = (sql, valor) => { params.push(valor); condiciones.push(sql.replace('?', `$${params.length}`)); };

    if (filtros.desde) {
        agregar(
            filtros.desde.tipo === 'fecha' ? 'l.occurred_at >= ?::date' : 'l.occurred_at >= ?::timestamptz',
            filtros.desde.valor
        );
    }
    if (filtros.hasta) {
        // Con una fecha sola, "hasta el 22" incluye todo el dia 22.
        agregar(
            filtros.hasta.tipo === 'fecha' ? 'l.occurred_at < (?::date + 1)' : 'l.occurred_at <= ?::timestamptz',
            filtros.hasta.valor
        );
    }
    if (filtros.soloSistema) condiciones.push(`l.actor_type = 'system'`);
    if (filtros.userId) agregar('l.user_id = ?', filtros.userId);
    if (filtros.modulo) agregar('l.module = ?', filtros.modulo);
    if (filtros.accion) agregar('l.action_type = ?', filtros.accion);
    if (filtros.recurso) agregar('l.resource_type = ?', filtros.recurso);

    return {
        where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
        params
    };
}

/** ORDER BY a partir de un valor ya validado. id desempata filas del mismo instante. */
const ordenSQL = (orden) => (orden === 'asc'
    ? 'ORDER BY l.occurred_at ASC, l.id ASC'
    : 'ORDER BY l.occurred_at DESC, l.id DESC');

/** Guarda un log ya enmascarado. Idempotente por log_uid (el bus puede reintentar). */
async function insertarLog(p) {
    await db.query(
        `INSERT INTO data.logs
            (log_uid, user_id, actor_type, actor_email, action_type, module,
             resource_type, resource_id, old_value, new_value, ip_address,
             trace_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (log_uid) DO NOTHING`,
        [
            p.logUid,
            p.actorType === 'system' ? null : p.userId,
            p.actorType === 'system' ? 'system' : 'user',
            p.actorEmail,
            p.actionType,
            p.module,
            p.resourceType,
            p.resourceId ?? null,
            p.oldValue === null || p.oldValue === undefined ? null : JSON.stringify(p.oldValue),
            p.newValue === null || p.newValue === undefined ? null : JSON.stringify(p.newValue),
            p.ipAddress ?? null,
            p.traceId ?? null,
            p.occurredAt
        ]
    );
}

async function contarLogs(filtros) {
    const { where, params } = construirWhere(filtros);
    const { rows: [{ total }] } = await db.query(
        `SELECT COUNT(*)::int AS total FROM data.logs l ${where}`, params
    );
    return total;
}

/** Pagina del listado, sin old_value/new_value (pueden ser JSON grandes). */
async function paginaDeLogs(filtros, { limit, offset }) {
    const { where, params } = construirWhere(filtros);
    const { rows } = await db.query(
        `SELECT l.id, l.occurred_at, l.user_id, l.actor_type, l.actor_email,
                l.action_type, l.module, l.resource_type, l.resource_id
           FROM data.logs l
           ${where}
           ${ordenSQL(filtros.orden)}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
    );
    return rows;
}

/** Detalle completo de un log, o null. */
async function detalleDeLog(id) {
    const { rows } = await db.query(
        `SELECT l.id, l.log_uid, l.occurred_at, l.recorded_at, l.user_id,
                l.actor_type, l.actor_email, l.action_type, l.module,
                l.resource_type, l.resource_id, l.old_value, l.new_value,
                l.ip_address, l.trace_id
           FROM data.logs l
          WHERE l.id = $1`,
        [id]
    );
    return rows[0] || null;
}

/** Usuarios que tienen acciones registradas, con su ultimo correo conocido. */
async function usuariosConAcciones() {
    const { rows } = await db.query(
        `SELECT DISTINCT ON (l.user_id) l.user_id, l.actor_email
           FROM data.logs l
          WHERE l.user_id IS NOT NULL
          ORDER BY l.user_id, l.occurred_at DESC
          LIMIT 1000`
    );
    return rows;
}

/** Logs para el CSV: mismos filtros y orden del listado, sin paginar, hasta `limite`. */
async function logsParaExportar(filtros, limite) {
    const { where, params } = construirWhere(filtros);
    const { rows } = await db.query(
        `SELECT l.id, l.occurred_at, l.user_id, l.actor_type, l.actor_email,
                l.action_type, l.module, l.resource_type, l.resource_id,
                l.old_value, l.new_value, l.ip_address, l.trace_id
           FROM data.logs l
           ${where}
           ${ordenSQL(filtros.orden)}
          LIMIT $${params.length + 1}`,
        [...params, limite]
    );
    return rows;
}

/**
 * Borra los logs anteriores al corte. Tiene que correr dentro de una
 * transaccion: SET LOCAL abre la unica llave del DELETE (trigger de la
 * migracion 011) y muere con la transaccion.
 *
 * @returns {Promise<{corte: Date, eliminados: number, desde: ?Date, hasta: ?Date}>}
 */
async function purgarAnterioresA({ ahora, meses }, tx) {
    await q(tx).query(`SET LOCAL app.retencion_logs = 'on'`);
    const { rows: [resultado] } = await q(tx).query(
        `WITH corte AS (
             SELECT ($1::timestamptz - make_interval(months => $2::int)) AS instante
         ),
         borrados AS (
             DELETE FROM data.logs
              WHERE occurred_at < (SELECT instante FROM corte)
          RETURNING occurred_at
         )
         SELECT (SELECT instante FROM corte)   AS corte,
                COUNT(*)::int                  AS eliminados,
                MIN(occurred_at)               AS desde,
                MAX(occurred_at)               AS hasta
           FROM borrados`,
        [ahora.toISOString(), meses]
    );
    return resultado;
}

/** Evidencia de una purga (va en la misma transaccion que el DELETE). */
async function registrarPurga({ meses, corte, eliminados, desde, hasta, traceId }, tx) {
    await q(tx).query(
        `INSERT INTO data.logs_purges
            (retention_months, cutoff, deleted_count, oldest_deleted, newest_deleted, trace_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [meses, corte, eliminados, desde, hasta, traceId]
    );
}

/** Historial de purgas, lo mas reciente primero. */
async function purgas(limite) {
    const { rows } = await db.query(
        `SELECT id, executed_at, retention_months, cutoff, deleted_count,
                oldest_deleted, newest_deleted
           FROM data.logs_purges
          ORDER BY executed_at DESC, id DESC
          LIMIT $1`,
        [limite]
    );
    return rows;
}

module.exports = {
    insertarLog,
    contarLogs,
    paginaDeLogs,
    detalleDeLog,
    usuariosConAcciones,
    logsParaExportar,
    purgarAnterioresA,
    registrarPurga,
    purgas
};
