const db = require('../config/db');

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
