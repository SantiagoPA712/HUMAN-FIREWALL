/**
 * Repositorio de recomendaciones (servicio de gamificacion).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): reglas,
 * historial de intentos y la proyeccion user_recommendations. Lee tablas de
 * evaluaciones y cursos declaradas en el manifiesto.
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/** Regla activa de recomendaciones (cero o una fila). */
async function reglaActiva() {
    const { rows } = await db.query(
        `SELECT code, description, score_threshold, include_failed, max_suggestions
           FROM recommendation_rules
          WHERE is_active = true
          ORDER BY code
          LIMIT 1`
    );
    return rows;
}

/** Resultado consolidado por evaluacion (intentos, mejor y ultimo puntaje). quiz_ref se compara contra id::varchar porque puede ser texto. */
async function evaluacionesConsolidadas(userId) {
    const { rows } = await db.query(
        `SELECT q.quiz_ref,
                q.quiz_type,
                MAX(q.course_id)                      AS course_id,
                COALESCE(c.title, cur.title)          AS curso,
                COALESCE(ch.name, s.title, q.quiz_ref) AS titulo,
                COUNT(*)::int                         AS intentos,
                MAX(q.score)::int                     AS mejor_puntaje,
                MIN(q.score)::int                     AS peor_puntaje,
                BOOL_OR(q.passed)                     AS aprobada,
                MAX(q.passing_score)::int             AS puntaje_minimo,
                MAX(q.created_at)                     AS ultimo_intento,

                -- El ultimo intento, no solo el mejor. Sin esto, alguien que
                -- aprobo una vez y despues fallo dos veces seguidas quedaba
                -- fuera de las areas de oportunidad: el sistema le decia
                -- "segui asi" justo cuando estaba desaprendiendo.
                (ARRAY_AGG(q.score  ORDER BY q.created_at DESC, q.id DESC))[1]::int
                                                      AS ultimo_puntaje,
                (ARRAY_AGG(q.passed ORDER BY q.created_at DESC, q.id DESC))[1]
                                                      AS ultimo_aprobado
           FROM quiz_attempts q
           LEFT JOIN challenges  ch ON q.quiz_type = 'challenge'  AND ch.id = q.quiz_ref
           LEFT JOIN simulations s  ON q.quiz_type = 'simulation' AND s.id::varchar = q.quiz_ref
           LEFT JOIN courses     c   ON c.id = q.course_id
           LEFT JOIN courses     cur ON cur.id = COALESCE(ch.course_id, s.course_id)
          WHERE q.user_id = $1
          GROUP BY q.quiz_ref, q.quiz_type, c.title, cur.title, ch.name, s.title
          ORDER BY MAX(q.score) ASC, MAX(q.created_at) DESC`,
        [userId]
    );
    return rows;
}

/** Desafios y simulaciones (de cursos asignados) que el usuario todavia no intento. */
async function evaluacionesPendientes(userId) {
    const { rows } = await db.query(
        `SELECT ch.id::varchar AS quiz_ref, 'challenge' AS quiz_type,
                ch.name AS titulo, ch.course_id, c.title AS curso,
                ch.points_reward AS puntos
           FROM challenges ch
           LEFT JOIN courses c ON c.id = ch.course_id
          WHERE NOT EXISTS (
                    SELECT 1 FROM quiz_attempts q
                     WHERE q.user_id = $1 AND q.quiz_type = 'challenge' AND q.quiz_ref = ch.id
                )

          UNION ALL

         SELECT s.id::varchar, 'simulation', s.title, s.course_id, c.title, NULL
           FROM simulations s
           LEFT JOIN courses c ON c.id = s.course_id
          WHERE NOT EXISTS (
                    SELECT 1 FROM quiz_attempts q
                     WHERE q.user_id = $1 AND q.quiz_type = 'simulation' AND q.quiz_ref = s.id::varchar
                )
            AND (s.course_id IS NULL OR s.course_id IN (
                    SELECT course_id FROM course_assignments WHERE user_id = $1
                ))
          ORDER BY titulo`,
        [userId]
    );
    return rows;
}

/** Intentos del usuario en orden cronologico, con el titulo de la evaluacion. */
async function serieDeIntentos(userId) {
    const { rows } = await db.query(
        `SELECT q.quiz_ref, q.quiz_type, q.score, q.passed, q.created_at,
                COALESCE(ch.name, s.title, q.quiz_ref) AS titulo
           FROM quiz_attempts q
           LEFT JOIN challenges  ch ON q.quiz_type = 'challenge'  AND ch.id = q.quiz_ref
           LEFT JOIN simulations s  ON q.quiz_type = 'simulation' AND s.id::varchar = q.quiz_ref
          WHERE q.user_id = $1
          ORDER BY q.created_at ASC, q.id ASC`,
        [userId]
    );
    return rows;
}

/** Lecciones totales y completadas por curso asignado. */
async function avanceDeCursos(userId) {
    const { rows } = await db.query(
        `SELECT c.id AS course_id,
                c.title AS curso,
                ca.status,
                COUNT(cc.id)::int AS lecciones_totales,
                COUNT(lp.id)::int AS lecciones_completadas
           FROM course_assignments ca
           JOIN courses c ON c.id = ca.course_id
           LEFT JOIN course_contents cc ON cc.course_id = c.id
           LEFT JOIN lesson_progress lp ON lp.content_id = cc.id AND lp.user_id = $1
          WHERE ca.user_id = $1
          GROUP BY c.id, c.title, ca.status
          ORDER BY c.title`,
        [userId]
    );
    return rows;
}

/** Lecciones de esos cursos que el usuario todavia no completo. */
async function leccionesPendientesDeCursos(cursos, userId) {
    const { rows } = await db.query(
        `SELECT cc.id AS content_id, cc.course_id, cc.content_type,
                cc.order_idx, cc.points_reward,
                c.title AS curso,
                LEFT(cc.body, 120) AS extracto
           FROM course_contents cc
           JOIN courses c ON c.id = cc.course_id
          WHERE cc.course_id = ANY($1::int[])
            AND NOT EXISTS (
                    SELECT 1 FROM lesson_progress lp
                     WHERE lp.user_id = $2 AND lp.content_id = cc.id
                )
          ORDER BY cc.course_id, cc.order_idx, cc.id`,
        [cursos, userId]
    );
    return rows;
}

/** UPSERT de la proyeccion de recomendaciones: una sola fila vigente por usuario. */
async function guardarProyeccion(userId, triggerEvent, areas, recomendaciones) {
    const { rows } = await db.query(
        `INSERT INTO user_recommendations (user_id, trigger_event, areas, recomendaciones, generated_at)
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
           FROM user_recommendations WHERE user_id = $1`,
        [userId]
    );
    return rows;
}

module.exports = {
    reglaActiva,
    evaluacionesConsolidadas,
    evaluacionesPendientes,
    serieDeIntentos,
    avanceDeCursos,
    leccionesPendientesDeCursos,
    guardarProyeccion,
    leerProyeccion
};
