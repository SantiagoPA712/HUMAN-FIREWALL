/**
 * Repositorio de las consultas de los endpoints de gamificacion (insignias,
 * catalogo de recompensas, reglas de puntos).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material). Solo toca el
 * esquema gamificacion: el ranking y el estado del usuario se piden a
 * identidad por su contrato.
 */

const db = require('./conexion');

/** Insignias ganadas, desde el snapshot de user_rewards (no del catalogo). */
async function insigniasDe(userId) {
    const { rows } = await db.query(
        `SELECT reward_name AS name, reward_description AS description,
                reward_icon_url AS icon_url, earned_at
           FROM gamificacion.user_rewards
          WHERE user_id = $1
          ORDER BY earned_at DESC`,
        [userId]
    );
    return rows;
}

async function insertarRecompensa({ name, description, iconUrl, conditionType, umbral, isRepeatable }) {
    const { rows } = await db.query(
        `INSERT INTO gamificacion.rewards_catalog
            (name, description, icon_url, condition_type, condition_params, is_repeatable, points_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [name, description, iconUrl, conditionType, JSON.stringify({ threshold: umbral }), isRepeatable, umbral]
    );
    return rows[0];
}

async function buscarRecompensa(id) {
    const { rows } = await db.query('SELECT * FROM gamificacion.rewards_catalog WHERE id = $1', [id]);
    return rows[0] || null;
}

async function catalogoPublico() {
    const { rows } = await db.query(
        `SELECT id, name, description, icon_url, condition_type,
                condition_params, is_repeatable
           FROM gamificacion.rewards_catalog
          WHERE is_active = true
          ORDER BY condition_type, id`
    );
    return rows;
}

async function reglasActivas() {
    const { rows } = await db.query(
        `SELECT code, source_type, points_mode, points, allow_repeat, description
           FROM gamificacion.points_rules WHERE is_active = true ORDER BY source_type`
    );
    return rows;
}

async function contarRecompensasDe(userId) {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM gamificacion.user_rewards WHERE user_id = $1', [userId]);
    return rows[0].n;
}

module.exports = {
    insigniasDe,
    insertarRecompensa,
    buscarRecompensa,
    catalogoPublico,
    reglasActivas,
    contarRecompensasDe
};
