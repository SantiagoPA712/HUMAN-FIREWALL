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
           FROM points_rules
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
        `INSERT INTO points_ledger (user_id, source_type, source_id, points, rule_code, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, user_id, source_type, source_id, points, rule_code, created_at`,
        [userId, sourceType, sourceId != null ? String(sourceId) : null, points, ruleCode, idempotencyKey]
    );
    return rows[0] || null;
}

/**
 * Recalcula la cache users.total_points desde el historial (escritura
 * compartida declarada en el manifiesto). Se recalcula en vez de
 * incrementarse para que no pueda desincronizarse de la fuente de verdad.
 */
async function recalcularTotalEnCache(userId, tx) {
    await q(tx).query(
        `UPDATE users
            SET total_points = (SELECT COALESCE(SUM(points), 0) FROM points_ledger WHERE user_id = $1)
          WHERE id = $1`,
        [userId]
    );
}

/** true si el usuario ya cobro puntos por esa evaluacion. */
async function yaCobroEvaluacion(userId, quizRef) {
    // rows.length y no rowCount: PGlite (el motor de las pruebas) no expone rowCount.
    const { rows } = await db.query(
        `SELECT 1 FROM points_ledger
          WHERE user_id = $1 AND source_type = 'quiz' AND source_id = $2
          LIMIT 1`,
        [userId, String(quizRef)]
    );
    return rows.length > 0;
}

async function existeClave(idempotencyKey) {
    const { rows } = await db.query(
        `SELECT 1 FROM points_ledger WHERE idempotency_key = $1 LIMIT 1`,
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
           FROM points_ledger
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
           FROM v_user_points WHERE user_id = $1`,
        [userId]
    );
    return rows[0] || null;
}

/** Pagina del historial, del mas reciente al mas antiguo. */
async function movimientosDe(userId, { limit, offset }) {
    const { rows } = await db.query(
        `SELECT id, source_type, source_id, points, rule_code, created_at
           FROM points_ledger
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );
    return rows;
}

module.exports = {
    reglaActiva,
    insertarMovimiento,
    recalcularTotalEnCache,
    yaCobroEvaluacion,
    existeClave,
    totalesPorUsuarios,
    resumenDe,
    movimientosDe
};
