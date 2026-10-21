/**
 * Repositorio de las consultas que antes escribia a mano
 * gamification.controller.js.
 *
 * Los servicios de aplicacion de este modulo (points, rewards, levels,
 * recommendations) todavia tienen su propio SQL adentro: separarlo es un
 * cambio grande sin beneficio inmediato, y la HU pide no reescribir de mas.
 * La regla que si se cumple desde ahora es que ningun controlador habla con
 * la base (lo verifica tests/arquitectura.test.mjs).
 */

const db = require('../../../../compartido/config/db');

/**
 * Top 10 por puntos. Lee las columnas de cache total_points y level de
 * users, que mantiene este mismo servicio (lectura declarada en el
 * manifiesto).
 */
async function ranking(limite = 10) {
    const { rows } = await db.query(
        `SELECT id, email, total_points, level
           FROM users
          WHERE is_active = true
          ORDER BY total_points DESC
          LIMIT $1`,
        [limite]
    );
    return rows;
}

async function estadoDe(userId) {
    const { rows } = await db.query('SELECT total_points, level FROM users WHERE id = $1', [userId]);
    return rows[0] || null;
}

/** Insignias ganadas, desde el snapshot de user_rewards (no del catalogo). */
async function insigniasDe(userId) {
    const { rows } = await db.query(
        `SELECT reward_name AS name, reward_description AS description,
                reward_icon_url AS icon_url, earned_at
           FROM user_rewards
          WHERE user_id = $1
          ORDER BY earned_at DESC`,
        [userId]
    );
    return rows;
}

async function insertarRecompensa({ name, description, iconUrl, conditionType, umbral, isRepeatable }) {
    const { rows } = await db.query(
        `INSERT INTO rewards_catalog
            (name, description, icon_url, condition_type, condition_params, is_repeatable, points_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [name, description, iconUrl, conditionType, JSON.stringify({ threshold: umbral }), isRepeatable, umbral]
    );
    return rows[0];
}

async function buscarRecompensa(id) {
    const { rows } = await db.query('SELECT * FROM rewards_catalog WHERE id = $1', [id]);
    return rows[0] || null;
}

async function catalogoPublico() {
    const { rows } = await db.query(
        `SELECT id, name, description, icon_url, condition_type,
                condition_params, is_repeatable
           FROM rewards_catalog
          WHERE is_active = true
          ORDER BY condition_type, id`
    );
    return rows;
}

async function reglasActivas() {
    const { rows } = await db.query(
        `SELECT code, source_type, points_mode, points, allow_repeat, description
           FROM points_rules WHERE is_active = true ORDER BY source_type`
    );
    return rows;
}

async function contarRecompensasDe(userId) {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM user_rewards WHERE user_id = $1', [userId]);
    return rows[0].n;
}

module.exports = {
    ranking,
    estadoDe,
    insigniasDe,
    insertarRecompensa,
    buscarRecompensa,
    catalogoPublico,
    reglasActivas,
    contarRecompensasDe
};
