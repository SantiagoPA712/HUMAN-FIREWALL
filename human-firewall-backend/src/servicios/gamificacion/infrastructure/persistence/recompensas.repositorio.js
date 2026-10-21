/**
 * Repositorio de recompensas: rewards_catalog y user_rewards (con el
 * snapshot de la recompensa al momento de otorgarse).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material).
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/** Puntos acumulados (vista v_user_points). */
async function puntosTotales(userId) {
    const { rows } = await db.query(
        `SELECT COALESCE(total_points, 0) AS valor FROM gamificacion.v_user_points WHERE user_id = $1`,
        [userId]
    );
    return rows[0]?.valor || 0;
}

/** Recompensas activas del catalogo. */
async function catalogoActivo() {
    const { rows } = await db.query(
        `SELECT id, name, description, icon_url, condition_type, condition_params, is_repeatable
           FROM gamificacion.rewards_catalog
          WHERE is_active = true
          ORDER BY id`
    );
    return rows;
}

/**
 * Inserta la recompensa ganada con su snapshot. Idempotente por dedupe_key:
 * devuelve null si ya la tenia.
 */
async function insertarOtorgada({ userId, recompensa, sourceType, sourceId, snapshot, dedupeKey }, tx) {
    const { rows } = await q(tx).query(
        `INSERT INTO gamificacion.user_rewards
            (user_id, reward_id, reward_name, reward_description, reward_icon_url,
             source_type, source_id, condition_snapshot, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id, reward_id, reward_name, reward_description, reward_icon_url, earned_at`,
        [
            userId,
            recompensa.id,
            recompensa.name,
            recompensa.description,
            recompensa.icon_url,
            sourceType,
            sourceId != null ? String(sourceId) : null,
            JSON.stringify(snapshot),
            dedupeKey
        ]
    );
    return rows[0] || null;
}

/** Resumen de recompensas de varios usuarios (to inclusive por dia). */
async function resumenPorUsuarios(userIds, { from = null, to = null } = {}) {
    const { rows } = await db.query(
        `SELECT user_id,
                COUNT(*)::int                    AS total,
                ARRAY_AGG(reward_name ORDER BY earned_at DESC) AS nombres,
                MAX(earned_at)                   AS ultima
           FROM gamificacion.user_rewards
          WHERE user_id = ANY($1::int[])
            AND ($2::timestamptz IS NULL OR earned_at >= $2::timestamptz)
            AND ($3::timestamptz IS NULL OR earned_at < ($3::timestamptz + interval '1 day'))
          GROUP BY user_id`,
        [userIds, from, to]
    );
    return rows;
}

/** Recompensas obtenidas por un usuario, de la mas reciente a la mas antigua. */
async function obtenidasPor(userId) {
    const { rows } = await db.query(
        `SELECT id, reward_id, reward_name, reward_description, reward_icon_url,
                source_type, source_id, condition_snapshot, earned_at
           FROM gamificacion.user_rewards
          WHERE user_id = $1
          ORDER BY earned_at DESC`,
        [userId]
    );
    return rows;
}

module.exports = { puntosTotales, catalogoActivo, insertarOtorgada, resumenPorUsuarios, obtenidasPor };
