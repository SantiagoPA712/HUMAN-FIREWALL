/**
 * Repositorio de niveles: levels_config, user_level_history y la cache
 * users.level.
 *
 * Capa Infrastructure / Persistence (seccion 11 del material). Las funciones
 * que participan de una transaccion reciben `tx` (el cliente que abre
 * application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('./conexion');

const q = (tx) => tx || db;

/** Escalera de niveles activos, de menor a mayor umbral. */
async function escalera() {
    const { rows } = await db.query(
        `SELECT level, name, description, icon_url, min_points
           FROM gamificacion.levels_config
          WHERE is_active = true
          ORDER BY min_points ASC, level ASC`
    );
    return rows;
}

/** Total acumulado del usuario, leido del historial (vista) y no de la cache. */
async function puntosDe(userId) {
    const { rows } = await db.query(
        `SELECT COALESCE(total_points, 0) AS total FROM gamificacion.v_user_points WHERE user_id = $1`,
        [userId]
    );
    // Un usuario sin ningun movimiento no aparece en la vista: tiene 0 puntos.
    return Number(rows[0]?.total || 0);
}

/** Niveles que el usuario ya alcanzo, del mas reciente al mas antiguo. */
async function historialDe(userId) {
    const { rows } = await db.query(
        `SELECT level, level_name, min_points, points_at, reached_at
           FROM gamificacion.user_level_history
          WHERE user_id = $1
          ORDER BY level DESC`,
        [userId]
    );
    return rows;
}

/** Registra que alcanzo un nivel. true si es nuevo, false si ya estaba. */
async function registrarNivelAlcanzado({ userId, nivel, puntos }, tx) {
    const { rows } = await q(tx).query(
        `INSERT INTO gamificacion.user_level_history (user_id, level, level_name, min_points, points_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, level) DO NOTHING
         RETURNING level`,
        [userId, nivel.level, nivel.name, nivel.min_points, puntos]
    );
    return rows.length > 0;
}

module.exports = { escalera, puntosDe, historialDe, registrarNivelAlcanzado };
