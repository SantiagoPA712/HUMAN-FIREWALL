/**
 * Repositorio de cursos: el unico archivo del servicio que escribe SQL.
 *
 * Capa de persistencia. No decide nada: no valida, no publica eventos y no
 * conoce HTTP. Solo traduce "dame esto" / "guarda esto" a consultas sobre
 * las tablas que son de este servicio (courses, course_contents,
 * course_assignments, lesson_progress).
 *
 * Las funciones que participan de una transaccion reciben `ejecutor`: el
 * cliente de la transaccion abierta por la capa de aplicacion. Si no se pasa,
 * usan el pool.
 */

const db = require('../../../compartido/config/db');

const q = (ejecutor) => ejecutor || db;

// ---------------------------------------------------------------------
// Cursos y contenidos
// ---------------------------------------------------------------------

async function insertarCurso({ title, description, instructorId }) {
    const { rows } = await db.query(
        'INSERT INTO courses (title, description, instructor_id) VALUES ($1, $2, $3) RETURNING *',
        [title, description, instructorId]
    );
    return rows[0];
}

async function insertarContenido({ courseId, contentType, body, orderIdx, pointsReward }) {
    const { rows } = await db.query(
        `INSERT INTO course_contents (course_id, content_type, body, order_idx, points_reward)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [courseId, contentType, body, orderIdx, pointsReward]
    );
    return rows[0];
}

async function listarTodos() {
    const { rows } = await db.query('SELECT * FROM courses');
    return rows;
}

async function listarAsignadosA(userId) {
    const { rows } = await db.query(
        `SELECT c.*, ca.status
           FROM courses c
           JOIN course_assignments ca ON c.id = ca.course_id
          WHERE ca.user_id = $1`,
        [userId]
    );
    return rows;
}

async function buscarPorId(courseId) {
    const { rows } = await db.query('SELECT * FROM courses WHERE id = $1', [courseId]);
    return rows[0] || null;
}

async function listarContenidos(courseId) {
    const { rows } = await db.query(
        'SELECT * FROM course_contents WHERE course_id = $1 ORDER BY order_idx ASC',
        [courseId]
    );
    return rows;
}

async function buscarContenido(contentId) {
    const { rows } = await db.query(
        'SELECT id, course_id, points_reward FROM course_contents WHERE id = $1',
        [contentId]
    );
    return rows[0] || null;
}

/** id y titulo de varios cursos a la vez (para etiquetar listados de otros servicios). */
async function titulosDe(ids) {
    if (!ids.length) return [];
    const { rows } = await db.query(
        'SELECT id, title FROM courses WHERE id = ANY($1::int[])',
        [ids]
    );
    return rows;
}

async function listarConCriticidad() {
    const { rows } = await db.query('SELECT id, title, is_critical FROM courses ORDER BY title');
    return rows;
}

async function actualizarCriticidad(courseId, critico) {
    const { rows } = await db.query(
        'UPDATE courses SET is_critical = $2 WHERE id = $1 RETURNING id, title, is_critical',
        [courseId, critico]
    );
    return rows[0] || null;
}

// ---------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------

async function insertarAsignacion({ courseId, userId, dueDate }, ejecutor) {
    const { rows } = await q(ejecutor).query(
        `INSERT INTO course_assignments (course_id, user_id, status, due_date)
         VALUES ($1, $2, 'assigned', $3) RETURNING *`,
        [courseId, userId, dueDate]
    );
    return rows[0];
}

async function idsDeCursosAsignados(userId) {
    const { rows } = await db.query(
        'SELECT DISTINCT course_id FROM course_assignments WHERE user_id = $1',
        [userId]
    );
    return rows.map(r => r.course_id);
}

async function contarCursosCompletados(userId) {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS valor
           FROM course_assignments
          WHERE user_id = $1 AND status = 'completed'`,
        [userId]
    );
    return rows[0].valor;
}

/**
 * Asignaciones abiertas que vencen dentro de la ventana y todavia no
 * avisaron. FOR UPDATE SKIP LOCKED: con varias instancias del servidor, cada
 * asignacion la toma una sola.
 */
async function bloquearAsignacionesPorVencer({ desde, ventanaHoras, limite }, ejecutor) {
    const { rows } = await q(ejecutor).query(
        `SELECT id, user_id, course_id, due_date
           FROM course_assignments
          WHERE due_date IS NOT NULL
            AND deadline_notified_at IS NULL
            AND COALESCE(status, 'assigned') <> 'completed'
            AND due_date > $1::timestamptz
            AND due_date <= $1::timestamptz + ($2 || ' hours')::interval
          ORDER BY due_date
          FOR UPDATE SKIP LOCKED
          LIMIT $3`,
        [desde.toISOString(), String(ventanaHoras), limite]
    );
    return rows;
}

async function marcarVencimientoAvisado(ids, ejecutor) {
    await q(ejecutor).query(
        'UPDATE course_assignments SET deadline_notified_at = now() WHERE id = ANY($1::int[])',
        [ids]
    );
}

/** Cierra la asignacion si seguia abierta. Devuelve true si la cerro esta llamada. */
async function cerrarAsignacion(courseId, userId) {
    const { rows } = await db.query(
        `UPDATE course_assignments
            SET status = 'completed', completed_at = now()
          WHERE course_id = $1 AND user_id = $2 AND status <> 'completed'
          RETURNING id`,
        [courseId, userId]
    );
    return rows.length > 0;
}

// ---------------------------------------------------------------------
// Progreso
// ---------------------------------------------------------------------

/** ON CONFLICT DO NOTHING: devuelve null si la leccion ya estaba completada. */
async function registrarLeccionCompletada(userId, contentId) {
    const { rows } = await db.query(
        `INSERT INTO lesson_progress (user_id, content_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, content_id) DO NOTHING
         RETURNING id, completed_at`,
        [userId, contentId]
    );
    return rows[0] || null;
}

async function contarLeccionesPendientes(courseId, userId) {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS faltan
           FROM course_contents cc
          WHERE cc.course_id = $1
            AND NOT EXISTS (
                SELECT 1 FROM lesson_progress lp
                 WHERE lp.content_id = cc.id AND lp.user_id = $2
            )`,
        [courseId, userId]
    );
    return rows[0].faltan;
}

async function contarLeccionesCompletadas(userId) {
    const { rows } = await db.query(
        'SELECT COUNT(*)::int AS valor FROM lesson_progress WHERE user_id = $1',
        [userId]
    );
    return rows[0].valor;
}

async function obtenerProgreso(courseId, userId) {
    const { rows } = await db.query(
        `SELECT
            COUNT(cc.id)::int                                   AS total_lecciones,
            COUNT(lc.id)::int                                   AS completadas,
            COALESCE(ARRAY_AGG(lc.content_id) FILTER (WHERE lc.id IS NOT NULL), '{}') AS ids_completados
           FROM course_contents cc
           LEFT JOIN lesson_progress lc
                  ON lc.content_id = cc.id AND lc.user_id = $2
          WHERE cc.course_id = $1`,
        [courseId, userId]
    );
    return rows[0];
}

module.exports = {
    insertarCurso,
    insertarContenido,
    listarTodos,
    listarAsignadosA,
    buscarPorId,
    listarContenidos,
    buscarContenido,
    titulosDe,
    listarConCriticidad,
    actualizarCriticidad,
    insertarAsignacion,
    idsDeCursosAsignados,
    contarCursosCompletados,
    bloquearAsignacionesPorVencer,
    marcarVencimientoAvisado,
    cerrarAsignacion,
    registrarLeccionCompletada,
    contarLeccionesPendientes,
    contarLeccionesCompletadas,
    obtenerProgreso
};
