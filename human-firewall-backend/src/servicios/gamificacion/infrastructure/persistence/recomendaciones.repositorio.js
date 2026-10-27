/**
 * Repositorio de recomendaciones (servicio de gamificacion).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): la regla
 * activa y la proyeccion user_recommendations. Los intentos y los cursos se
 * piden a evaluaciones y cursos por su contrato.
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('./conexion');

const q = (tx) => tx || db;

/** Regla activa de recomendaciones (cero o una fila). */
async function reglaActiva() {
    const { rows } = await db.query(
        `SELECT code, description, score_threshold, include_failed, max_suggestions
           FROM gamificacion.recommendation_rules
          WHERE is_active = true
          ORDER BY code
          LIMIT 1`
    );
    return rows;
}

/** UPSERT de la proyeccion de recomendaciones: una sola fila vigente por usuario. */
async function guardarProyeccion(userId, triggerEvent, areas, recomendaciones) {
    const { rows } = await db.query(
        `INSERT INTO gamificacion.user_recommendations (user_id, trigger_event, areas, recomendaciones, generated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id) DO UPDATE
            SET trigger_event   = EXCLUDED.trigger_event,
                areas           = EXCLUDED.areas,
                recomendaciones = EXCLUDED.recomendaciones,
                generated_at    = now()
         RETURNING user_id, trigger_event, areas, recomendaciones, generated_at`,
        [userId, triggerEvent, JSON.stringify(areas), JSON.stringify(recomendaciones)]
    );
    return rows;
}

/** Proyeccion guardada del usuario. */
async function leerProyeccion(userId) {
    const { rows } = await db.query(
        `SELECT user_id, trigger_event, areas, recomendaciones, generated_at
           FROM gamificacion.user_recommendations WHERE user_id = $1`,
        [userId]
    );
    return rows;
}

module.exports = {
    reglaActiva,
    guardarProyeccion,
    leerProyeccion
};
