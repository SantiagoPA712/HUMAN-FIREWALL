/**
 * Repositorio de evaluaciones: simulaciones, desafios e intentos.
 *
 * Capa de persistencia del servicio. Solo toca sus tablas (simulations,
 * simulation_steps, simulation_options, challenges, user_challenge_results,
 * quiz_attempts). Lo que necesita de cursos lo pide por el cliente.
 */

const db = require('../../../../compartido/config/db');

const q = (ejecutor) => ejecutor || db;

// ---------------------------------------------------------------------
// Simulaciones
// ---------------------------------------------------------------------

/**
 * Simulaciones visibles. Los gestores ven todas (incluso vacias); el resto
 * ve las que no tienen curso y las de sus cursos asignados, y solo si tienen
 * al menos un paso.
 */
async function listarSimulaciones({ userId, esGestor, cursosPermitidos }) {
    const { rows } = await db.query(
        `SELECT s.id, s.title, s.description, s.difficulty, s.course_id,
                COUNT(st.id)::int AS pasos,
                EXISTS (SELECT 1 FROM evaluaciones.quiz_attempts q
                         WHERE q.user_id = $1
                           AND q.quiz_type = 'simulation'
                           AND q.quiz_ref = s.id::varchar) AS intentada
           FROM evaluaciones.simulations s
           LEFT JOIN evaluaciones.simulation_steps st ON st.simulation_id = s.id
          WHERE $2::boolean = true
             OR s.course_id IS NULL
             OR s.course_id = ANY($3::int[])
          GROUP BY s.id, s.title, s.description, s.difficulty, s.course_id
         HAVING COUNT(st.id) > 0 OR $2::boolean = true
          ORDER BY s.id`,
        [userId, esGestor, cursosPermitidos || []]
    );
    return rows;
}

async function insertarSimulacion({ title, description, difficulty, createdBy }) {
    const { rows } = await db.query(
        'INSERT INTO evaluaciones.simulations (title, description, difficulty, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [title, description, difficulty, createdBy]
    );
    return rows[0];
}

async function insertarPaso({ simulationId, scenarioText, orderIdx }) {
    const { rows } = await db.query(
        'INSERT INTO evaluaciones.simulation_steps (simulation_id, scenario_text, order_idx) VALUES ($1, $2, $3) RETURNING *',
        [simulationId, scenarioText, orderIdx]
    );
    return rows[0];
}

async function insertarOpcion({ stepId, optionText, isCorrect, pointsAwarded, feedbackText }) {
    const { rows } = await db.query(
        `INSERT INTO evaluaciones.simulation_options (step_id, option_text, is_correct, points_awarded, feedback_text)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [stepId, optionText, isCorrect, pointsAwarded, feedbackText]
    );
    return rows[0];
}

async function buscarSimulacion(simulationId) {
    const { rows } = await db.query('SELECT * FROM evaluaciones.simulations WHERE id = $1', [simulationId]);
    return rows[0] || null;
}

async function listarPasos(simulationId) {
    const { rows } = await db.query(
        'SELECT * FROM evaluaciones.simulation_steps WHERE simulation_id = $1 ORDER BY order_idx ASC',
        [simulationId]
    );
    return rows;
}

async function listarOpcionesDePaso(stepId) {
    const { rows } = await db.query('SELECT * FROM evaluaciones.simulation_options WHERE step_id = $1', [stepId]);
    return rows;
}

async function buscarOpcion(optionId) {
    const { rows } = await db.query('SELECT * FROM evaluaciones.simulation_options WHERE id = $1', [optionId]);
    return rows[0] || null;
}

async function simulacionDePaso(stepId) {
    const { rows } = await db.query(
        'SELECT s.simulation_id FROM evaluaciones.simulation_steps s WHERE s.id = $1',
        [stepId]
    );
    return rows[0] ? rows[0].simulation_id : null;
}

/** Todas las opciones de una simulacion, con el paso al que pertenecen. */
async function opcionesDeSimulacion(simulationId) {
    const { rows } = await db.query(
        `SELECT o.id, o.step_id, o.is_correct, o.points_awarded
           FROM evaluaciones.simulation_options o
           JOIN evaluaciones.simulation_steps s ON s.id = o.step_id
          WHERE s.simulation_id = $1`,
        [simulationId]
    );
    return rows;
}

// ---------------------------------------------------------------------
// Desafios
// ---------------------------------------------------------------------

async function buscarDesafio(challengeId, ejecutor) {
    const { rows } = await q(ejecutor).query('SELECT * FROM evaluaciones.challenges WHERE id = $1', [challengeId]);
    return rows[0] || null;
}

/** Marca el desafio como ganado. Devuelve false si ya estaba ganado. */
async function marcarDesafioGanado(userId, challengeId, ejecutor) {
    const { rows } = await q(ejecutor).query(
        `INSERT INTO evaluaciones.user_challenge_results (user_id, challenge_id, won)
         VALUES ($1, $2, true)
         ON CONFLICT (user_id, challenge_id) DO NOTHING
         RETURNING id`,
        [userId, challengeId]
    );
    return rows.length > 0;
}

// ---------------------------------------------------------------------
// Intentos
// ---------------------------------------------------------------------

/**
 * Registra un intento. Devuelve { id, attempt_no }:
 *   - `id` IDENTIFICA el intento (lo asigna la secuencia, es unico aunque
 *     dos envios entren a la vez);
 *   - `attempt_no` es para mostrar ("intento 2"): sale de un COUNT(*) + 1
 *     sin lock y puede repetirse.
 *
 * Los tipos van explicitos: $1 y $2 se usan en el VALUES y en la subconsulta,
 * y sin cast Postgres deduce tipos distintos en cada contexto.
 */
async function registrarIntento({ userId, quizRef, quizType, courseId, score, passingScore, passed }, ejecutor) {
    const { rows } = await q(ejecutor).query(
        `INSERT INTO evaluaciones.quiz_attempts (user_id, quiz_ref, quiz_type, course_id, score, passing_score, passed, attempt_no)
         VALUES ($1::int, $2::varchar, $3::varchar, $4::int, $5::int, $6::int, $7::boolean,
                 (SELECT COUNT(*) + 1 FROM evaluaciones.quiz_attempts
                   WHERE user_id = $1::int AND quiz_ref = $2::varchar))
         RETURNING id, attempt_no`,
        [userId, String(quizRef), quizType, courseId || null, score, passingScore, passed]
    );
    return rows[0];
}

async function contarEvaluacionesAprobadas(userId) {
    const { rows } = await db.query(
        `SELECT COUNT(DISTINCT quiz_ref)::int AS valor
           FROM evaluaciones.quiz_attempts
          WHERE user_id = $1 AND passed = true`,
        [userId]
    );
    return rows[0].valor;
}

/** Resultados de los ultimos intentos, del mas reciente al mas viejo. */
async function ultimosResultados(userId, limite = 100) {
    const { rows } = await db.query(
        `SELECT passed FROM evaluaciones.quiz_attempts
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2`,
        [userId, limite]
    );
    return rows.map(r => r.passed);
}

async function nombreDeDesafio(quizRef) {
    const { rows } = await db.query('SELECT name FROM evaluaciones.challenges WHERE id = $1', [String(quizRef)]);
    return rows[0]?.name || null;
}

async function tituloDeSimulacion(simulationId) {
    const { rows } = await db.query('SELECT title FROM evaluaciones.simulations WHERE id = $1', [simulationId]);
    return rows[0]?.title || null;
}

// ---------------------------------------------------------------------
// Consultas para otros servicios (base de datos por servicio)
// ---------------------------------------------------------------------

/**
 * Resultado consolidado por evaluacion: intentos, mejor y ultimo puntaje.
 * quiz_ref se compara contra id::varchar porque puede ser texto (desafios).
 *
 * course_id es el curso del intento; course_id_evaluacion, el curso al que
 * pertenece la evaluacion (desafio o simulacion). El titulo del curso lo
 * resuelve quien consulta, con el contrato de cursos.
 */
async function resultadosConsolidados(userId) {
    const { rows } = await db.query(
        `SELECT q.quiz_ref,
                q.quiz_type,
                MAX(q.course_id)                       AS course_id,
                MAX(COALESCE(ch.course_id, s.course_id)) AS course_id_evaluacion,
                COALESCE(ch.name, s.title, q.quiz_ref) AS titulo,
                COUNT(*)::int                          AS intentos,
                MAX(q.score)::int                      AS mejor_puntaje,
                MIN(q.score)::int                      AS peor_puntaje,
                BOOL_OR(q.passed)                      AS aprobada,
                MAX(q.passing_score)::int              AS puntaje_minimo,
                MAX(q.created_at)                      AS ultimo_intento,
                (ARRAY_AGG(q.score  ORDER BY q.created_at DESC, q.id DESC))[1]::int AS ultimo_puntaje,
                (ARRAY_AGG(q.passed ORDER BY q.created_at DESC, q.id DESC))[1]      AS ultimo_aprobado
           FROM evaluaciones.quiz_attempts q
           LEFT JOIN evaluaciones.challenges  ch ON q.quiz_type = 'challenge'  AND ch.id = q.quiz_ref
           LEFT JOIN evaluaciones.simulations s  ON q.quiz_type = 'simulation' AND s.id::varchar = q.quiz_ref
          WHERE q.user_id = $1
          GROUP BY q.quiz_ref, q.quiz_type, ch.name, s.title
          ORDER BY MAX(q.score) ASC, MAX(q.created_at) DESC`,
        [userId]
    );
    return rows;
}

/**
 * Evaluaciones que el usuario todavia no intento: todos los desafios del
 * portal, y las simulaciones sin curso o de los cursos que tiene asignados
 * (los ids los da el contrato de cursos).
 */
async function pendientesDe(userId, cursosAsignados) {
    const { rows } = await db.query(
        `SELECT ch.id::varchar AS quiz_ref, 'challenge' AS quiz_type,
                ch.name AS titulo, ch.course_id, ch.points_reward AS puntos
           FROM evaluaciones.challenges ch
          WHERE NOT EXISTS (
                    SELECT 1 FROM evaluaciones.quiz_attempts q
                     WHERE q.user_id = $1 AND q.quiz_type = 'challenge' AND q.quiz_ref = ch.id
                )

          UNION ALL

         SELECT s.id::varchar, 'simulation', s.title, s.course_id, NULL
           FROM evaluaciones.simulations s
          WHERE NOT EXISTS (
                    SELECT 1 FROM evaluaciones.quiz_attempts q
                     WHERE q.user_id = $1 AND q.quiz_type = 'simulation' AND q.quiz_ref = s.id::varchar
                )
            AND (s.course_id IS NULL OR s.course_id = ANY($2::int[]))
          ORDER BY titulo`,
        [userId, cursosAsignados]
    );
    return rows;
}

/** Intentos del usuario en orden cronologico, con el titulo de la evaluacion. */
async function serieDeIntentos(userId) {
    const { rows } = await db.query(
        `SELECT q.quiz_ref, q.quiz_type, q.score, q.passed, q.created_at,
                COALESCE(ch.name, s.title, q.quiz_ref) AS titulo
           FROM evaluaciones.quiz_attempts q
           LEFT JOIN evaluaciones.challenges  ch ON q.quiz_type = 'challenge'  AND ch.id = q.quiz_ref
           LEFT JOIN evaluaciones.simulations s  ON q.quiz_type = 'simulation' AND s.id::varchar = q.quiz_ref
          WHERE q.user_id = $1
          ORDER BY q.created_at ASC, q.id ASC`,
        [userId]
    );
    return rows;
}

/** Intentos por usuario en [desde, hasta). Cualquiera de los dos puede ser null. */
async function intentosPorUsuarioEntre(desde = null, hasta = null) {
    const { rows } = await db.query(
        `SELECT user_id, COUNT(*)::int AS acciones
           FROM evaluaciones.quiz_attempts
          WHERE ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
            AND ($2::timestamptz IS NULL OR created_at <  $2::timestamptz)
          GROUP BY user_id`,
        [desde, hasta]
    );
    return rows;
}

/** Ultimo intento de cada usuario. */
async function ultimoIntentoDe(userIds) {
    if (!userIds.length) return [];
    const { rows } = await db.query(
        `SELECT user_id, MAX(created_at) AS ultima
           FROM evaluaciones.quiz_attempts
          WHERE user_id = ANY($1::int[])
          GROUP BY user_id`,
        [userIds]
    );
    return rows;
}

module.exports = {
    resultadosConsolidados,
    pendientesDe,
    serieDeIntentos,
    intentosPorUsuarioEntre,
    ultimoIntentoDe,
    listarSimulaciones,
    insertarSimulacion,
    insertarPaso,
    insertarOpcion,
    buscarSimulacion,
    listarPasos,
    listarOpcionesDePaso,
    buscarOpcion,
    simulacionDePaso,
    opcionesDeSimulacion,
    buscarDesafio,
    marcarDesafioGanado,
    registrarIntento,
    contarEvaluacionesAprobadas,
    ultimosResultados,
    nombreDeDesafio,
    tituloDeSimulacion
};
