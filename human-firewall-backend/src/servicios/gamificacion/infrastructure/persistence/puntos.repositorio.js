/**
 * Repositorio de puntos: points_rules, points_ledger (historial inmutable),
 * la vista v_user_points y la cache users.total_points.
 *
 * Capa Infrastructure / Persistence (seccion 11 del material). Las funciones
 * que participan de una transaccion reciben `tx`; sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/** Regla activa del catalogo, o null. */
async function reglaActiva(code) {
    const { rows } = await db.query(
        `SELECT code, source_type, points_mode, points, allow_repeat, is_active
           FROM gamificacion.points_rules
          WHERE code = $1 AND is_active = true`,
        [code]
    );
    return rows[0] || null;
}

/**
 * Inserta un movimiento. Idempotente por idempotency_key: si ya existia
 * devuelve null y no inserta nada.
 */
async function insertarMovimiento({ userId, sourceType, sourceId, points, ruleCode, idempotencyKey }, tx) {
    const { rows } = await q(tx).query(
        `INSERT INTO gamificacion.points_ledger (user_id, source_type, source_id, points, rule_code, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, user_id, source_type, source_id, points, rule_code, created_at`,
        [userId, sourceType, sourceId != null ? String(sourceId) : null, points, ruleCode, idempotencyKey]
    );
    return rows[0] || null;
}

/** true si el usuario ya cobro puntos por esa evaluacion. */
async function yaCobroEvaluacion(userId, quizRef) {
    // rows.length y no rowCount: PGlite (el motor de las pruebas) no expone rowCount.
    const { rows } = await db.query(
        `SELECT 1 FROM gamificacion.points_ledger
          WHERE user_id = $1 AND source_type = 'quiz' AND source_id = $2
          LIMIT 1`,
        [userId, String(quizRef)]
    );
    return rows.length > 0;
}

async function existeClave(idempotencyKey) {
    const { rows } = await db.query(
        `SELECT 1 FROM gamificacion.points_ledger WHERE idempotency_key = $1 LIMIT 1`,
        [idempotencyKey]
    );
    return rows.length > 0;
}

/** Totales por usuario, opcionalmente acotados a un rango (to inclusive por dia). */
async function totalesPorUsuarios(userIds, { from = null, to = null } = {}) {
    const { rows } = await db.query(
        `SELECT user_id,
                COALESCE(SUM(points), 0)::int AS total,
                COUNT(*)::int                 AS movimientos,
                MAX(created_at)               AS ultimo
           FROM gamificacion.points_ledger
          WHERE user_id = ANY($1::int[])
            AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
            -- El "to" se recibe como fecha (2026-03-01) y se interpreta como
            -- el dia completo: sin el +1 dia, un movimiento de las 14:00 de
            -- ese mismo dia quedaria fuera del rango.
            AND ($3::timestamptz IS NULL OR created_at < ($3::timestamptz + interval '1 day'))
          GROUP BY user_id`,
        [userIds, from, to]
    );
    return rows;
}

/** Resumen de la vista v_user_points, o null si no tiene movimientos. */
async function resumenDe(userId) {
    const { rows } = await db.query(
        `SELECT total_points, movimientos, ultimo_movimiento
           FROM gamificacion.v_user_points WHERE user_id = $1`,
        [userId]
    );
    return rows[0] || null;
}

/** Pagina del historial, del mas reciente al mas antiguo. */
async function movimientosDe(userId, { limit, offset }) {
    const { rows } = await db.query(
        `SELECT id, source_type, source_id, points, rule_code, created_at
           FROM gamificacion.points_ledger
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );
    return rows;
}

// ---------------------------------------------------------------------
// Consultas para otros servicios (base de datos por servicio)
// ---------------------------------------------------------------------

/** Total del historial de un usuario (para la cache de identidad). */
async function totalDe(userId, tx) {
    const { rows } = await q(tx).query(
        'SELECT COALESCE(SUM(points), 0)::int AS total FROM gamificacion.points_ledger WHERE user_id = $1',
        [userId]
    );
    return rows[0].total;
}

/** Movimientos por usuario en [desde, hasta). Cualquiera de los dos puede ser null. */
async function movimientosPorUsuarioEntre(desde = null, hasta = null) {
    const { rows } = await db.query(
        `SELECT user_id, COUNT(*)::int AS acciones
           FROM gamificacion.points_ledger
          WHERE ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
            AND ($2::timestamptz IS NULL OR created_at <  $2::timestamptz)
          GROUP BY user_id`,
        [desde, hasta]
    );
    return rows;
}

/** Ultimo movimiento de cada usuario. */
async function ultimoMovimientoDe(userIds) {
    if (!userIds.length) return [];
    const { rows } = await db.query(
        `SELECT user_id, MAX(created_at) AS ultima
           FROM gamificacion.points_ledger
          WHERE user_id = ANY($1::int[])
          GROUP BY user_id`,
        [userIds]
    );
    return rows;
}

/** Puntos acumulados por usuario antes de una fecha (solo quienes tienen alguno). */
async function puntosPorUsuarioHasta(fin) {
    const { rows } = await db.query(
        `SELECT user_id, COALESCE(SUM(points), 0)::int AS puntos
           FROM gamificacion.points_ledger
          WHERE created_at < $1::timestamptz
          GROUP BY user_id`,
        [fin]
    );
    return rows;
}

/** Movimientos del usuario en la ventana de N minutos que termina en `hasta` (o ahora). */
async function movimientosEnVentana(userId, ventanaMinutos, hasta = null) {
    const { rows } = await db.query(
        `SELECT id, source_type, source_id, points, rule_code, created_at
           FROM gamificacion.points_ledger
          WHERE user_id = $1
            AND created_at >  COALESCE($3::timestamptz, now()) - ($2 || ' minutes')::interval
            AND created_at <= COALESCE($3::timestamptz, now())
          ORDER BY created_at, id`,
        [userId, String(ventanaMinutos), hasta]
    );
    return rows;
}

/** Usuarios con movimientos en los ultimos N minutos. */
async function usuariosConMovimientosRecientes(minutos) {
    const { rows } = await db.query(
        `SELECT DISTINCT user_id FROM gamificacion.points_ledger
          WHERE created_at > now() - ($1 || ' minutes')::interval`,
        [String(minutos)]
    );
    return rows.map(r => r.user_id);
}

/** Ultimos N movimientos del usuario, del mas reciente al mas antiguo. */
async function ultimosMovimientos(userId, limite = 50) {
    const { rows } = await db.query(
        `SELECT id, source_type, source_id, points, rule_code, created_at
           FROM gamificacion.points_ledger
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, limite]
    );
    return rows;
}

module.exports = {
    totalDe,
    movimientosPorUsuarioEntre,
    ultimoMovimientoDe,
    puntosPorUsuarioHasta,
    movimientosEnVentana,
    usuariosConMovimientosRecientes,
    ultimosMovimientos,
    reglaActiva,
    insertarMovimiento,
    yaCobroEvaluacion,
    existeClave,
    totalesPorUsuarios,
    resumenDe,
    movimientosDe
};
