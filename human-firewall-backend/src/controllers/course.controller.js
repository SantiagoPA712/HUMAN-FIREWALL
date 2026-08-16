const db = require('../config/db');
const eventBus = require('../services/eventBus');

exports.createCourse = async (req, res) => {
    try {
        const { title, description } = req.body;
        // Instructor id viene del token (req.user)
        const instructor_id = req.user.id;

        if (!title) return res.status(400).json({ msg: "El título es obligatorio" });

        const { rows } = await db.query(
            "INSERT INTO courses (title, description, instructor_id) VALUES ($1, $2, $3) RETURNING *",
            [title, description, instructor_id]
        );

        res.status(201).json(rows[0]);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.addContent = async (req, res) => {
    try {
        const { courseId } = req.params;
        const { content_type, body, order_idx, points_reward } = req.body;

        const { rows } = await db.query(
            "INSERT INTO course_contents (course_id, content_type, body, order_idx, points_reward) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [courseId, content_type, body, order_idx || 0, points_reward || 10]
        );

        res.status(201).json(rows[0]);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.assignCourse = async (req, res) => {
    try {
        const { course_id, user_id } = req.body;

        const { rows } = await db.query(
            "INSERT INTO course_assignments (course_id, user_id, status) VALUES ($1, $2, 'assigned') RETURNING *",
            [course_id, user_id]
        );

        res.status(201).json(rows[0]);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.getCourses = async (req, res) => {
    try {
        const { role, id: userId } = req.user;
        let query;
        let params = [];

        if (role === 'admin' || role === 'instructor') {
            // Pueden ver todos
            query = "SELECT * FROM courses";
        } else {
            // Empleados solo ven los asignados
            query = `
                SELECT c.*, ca.status 
                FROM courses c
                JOIN course_assignments ca ON c.id = ca.course_id
                WHERE ca.user_id = $1
            `;
            params = [userId];
        }

        const { rows } = await db.query(query, params);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.getCourseDetails = async (req, res) => {
    try {
        const { courseId } = req.params;

        const { rows: courseRows } = await db.query("SELECT * FROM courses WHERE id = $1", [courseId]);
        if (courseRows.length === 0) return res.status(404).json({ msg: "Curso no encontrado" });

        const { rows: contentRows } = await db.query("SELECT * FROM course_contents WHERE course_id = $1 ORDER BY order_idx ASC", [courseId]);

        res.status(200).json({
            ...courseRows[0],
            contents: contentRows
        });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * POST /api/courses/contents/:contentId/complete
 *
 * Marca una leccion como completada y encola el evento lesson.completed.
 *
 * La asignacion de puntos NO ocurre aca: solo se encola el evento y se
 * responde (criterio tecnico 1). Por eso la respuesta incluye
 * puntos_estimados y no puntos_otorgados: sirve para que el frontend muestre
 * el toast de inmediato, pero el valor definitivo queda en el historial.
 */
exports.completeLesson = async (req, res) => {
    try {
        const contentId = Number.parseInt(req.params.contentId, 10);
        const userId = req.user.id;

        if (!Number.isInteger(contentId) || contentId <= 0) {
            return res.status(400).json({ msg: "contentId invalido" });
        }

        const { rows: contentRows } = await db.query(
            "SELECT id, course_id, points_reward FROM course_contents WHERE id = $1",
            [contentId]
        );
        if (contentRows.length === 0) {
            return res.status(404).json({ msg: "Leccion no encontrada" });
        }

        // ON CONFLICT DO NOTHING: completar dos veces la misma leccion no
        // genera un segundo evento, asi que tampoco duplica puntos.
        const { rows: insertadas } = await db.query(
            `INSERT INTO lesson_progress (user_id, content_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, content_id) DO NOTHING
             RETURNING id, completed_at`,
            [userId, contentId]
        );

        if (insertadas.length === 0) {
            return res.status(200).json({
                msg: "Esta leccion ya estaba completada",
                ya_completada: true,
                puntos_estimados: 0
            });
        }

        await eventBus.publish('lesson.completed', { userId, contentId });

        // Si con esta leccion el usuario termino el curso, se marca la
        // asignacion y se emite course.completed. Sin esto, la condicion
        // "cursos finalizados" del catalogo de recompensas nunca se cumpliria:
        // no habia nada en el sistema que cerrara un curso.
        const courseId = contentRows[0].course_id;
        const { rows: pendientes } = await db.query(
            `SELECT COUNT(*)::int AS faltan
               FROM course_contents cc
              WHERE cc.course_id = $1
                AND NOT EXISTS (
                    SELECT 1 FROM lesson_progress lp
                     WHERE lp.content_id = cc.id AND lp.user_id = $2
                )`,
            [courseId, userId]
        );

        let cursoCompletado = false;
        if (pendientes[0].faltan === 0) {
            const { rows: cerradas } = await db.query(
                `UPDATE course_assignments
                    SET status = 'completed', completed_at = now()
                  WHERE course_id = $1 AND user_id = $2 AND status <> 'completed'
                  RETURNING id`,
                [courseId, userId]
            );

            // Solo se emite si la asignacion paso a completada en esta llamada,
            // para no disparar el evento cada vez que se reabre el curso.
            if (cerradas.length > 0) {
                cursoCompletado = true;
                await eventBus.publish('course.completed', { userId, courseId });
            }
        }

        res.status(201).json({
            curso_completado: cursoCompletado,
            msg: "Leccion completada",
            ya_completada: false,
            content_id: contentId,
            course_id: contentRows[0].course_id,
            puntos_estimados: contentRows[0].points_reward,
            completed_at: insertadas[0].completed_at
        });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/courses/:courseId/progress
 * Progreso del usuario autenticado en un curso: cuantas lecciones completo.
 */
exports.getCourseProgress = async (req, res) => {
    try {
        const courseId = Number.parseInt(req.params.courseId, 10);
        const userId = req.user.id;

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

        const p = rows[0];
        res.status(200).json({
            course_id: courseId,
            total_lecciones: p.total_lecciones,
            completadas: p.completadas,
            porcentaje: p.total_lecciones > 0
                ? Math.round(p.completadas * 100 / p.total_lecciones)
                : 0,
            ids_completados: p.ids_completados
        });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
