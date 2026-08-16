const db = require('../config/db');
const pointsService = require('../services/points.service');
const eventBus = require('../services/eventBus');

exports.getLeaderboard = async (req, res) => {
    try {
        const { rows } = await db.query(
            "SELECT id, email, total_points, level FROM users WHERE is_active = true ORDER BY total_points DESC LIMIT 10"
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.getMyStatus = async (req, res) => {
    try {
        const userId = req.user.id;

        const { rows: userRows } = await db.query(
            "SELECT total_points, level FROM users WHERE id = $1",
            [userId]
        );

        if (userRows.length === 0) return res.status(404).json({ msg: "Usuario no encontrado" });

        const { rows: badgeRows } = await db.query(`
            SELECT b.name, b.description, b.icon_url, ub.earned_at 
            FROM user_badges ub 
            JOIN badges b ON ub.badge_id = b.id 
            WHERE ub.user_id = $1
        `, [userId]);

        res.status(200).json({
            gamification: userRows[0],
            badges: badgeRows
        });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.createBadge = async (req, res) => {
    try {
        const { name, description, points_required, icon_url } = req.body;
        if (!name) return res.status(400).json({ msg: "El nombre de la insignia es obligatorio" });

        const { rows } = await db.query(
            "INSERT INTO badges (name, description, points_required, icon_url) VALUES ($1, $2, $3, $4) RETURNING *",
            [name, description, points_required || 0, icon_url]
        );

        res.status(201).json(rows[0]);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.assignBadge = async (req, res) => {
    try {
        const { user_id, badge_id } = req.body;

        const { rows } = await db.query(
            "INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *",
            [user_id, badge_id]
        );

        if (rows.length === 0) {
            return res.status(200).json({ msg: "El usuario ya tiene esta insignia" });
        }

        res.status(201).json({ msg: "Insignia asignada exitosamente", data: rows[0] });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * POST /api/gamification/challenge
 *
 * FALLO CORREGIDO: la version anterior hacia INSERT en user_challenge_results
 * y despues UPDATE users en dos queries sueltas, sin transaccion. Si el UPDATE
 * fallaba, el UNIQUE(user_id, challenge_id) bloqueaba el reintento y el usuario
 * perdia los puntos para siempre.
 *
 * Ahora el desafio se trata como una evaluacion aprobada: se registra el
 * intento y se encola quiz.approved. Los puntos los asigna el servicio de
 * gamificacion de forma asincrona contra el historial inmutable.
 */
exports.completeChallenge = async (req, res) => {
    try {
        const { challengeId } = req.body;
        const userId = req.user.id;

        if (!challengeId) return res.status(400).json({ msg: "El ID del desafío es obligatorio" });

        const { rows: challengeRows } = await db.query(
            "SELECT * FROM challenges WHERE id = $1", [challengeId]
        );
        if (challengeRows.length === 0) return res.status(404).json({ msg: "Desafío no encontrado" });

        const challenge = challengeRows[0];

        // Registro del resultado. ON CONFLICT DO NOTHING en lugar de dejar
        // explotar el UNIQUE: repetir un desafio ya ganado no es un error.
        const { rows: nuevas } = await db.query(
            `INSERT INTO user_challenge_results (user_id, challenge_id, won)
             VALUES ($1, $2, true)
             ON CONFLICT (user_id, challenge_id) DO NOTHING
             RETURNING id`,
            [userId, challengeId]
        );

        const yaGanado = nuevas.length === 0;

        // Historial de intentos: alimenta la regla de "no duplicar puntos por
        // el mismo logro" y deja trazabilidad de cada aprobacion.
        // course_id se guarda desnormalizado: el intento debe conservar a que
        // curso pertenecia la evaluacion en ese momento, aunque despues cambie.
        await db.query(
            `INSERT INTO quiz_attempts (user_id, quiz_ref, quiz_type, course_id, score, passing_score, passed, attempt_no)
             VALUES ($1, $2, 'challenge', $3, 100, 60, true,
                     (SELECT COUNT(*) + 1 FROM quiz_attempts WHERE user_id = $1 AND quiz_ref = $2))`,
            [userId, challengeId, challenge.course_id || null]
        );

        // Solo se encola si es la primera vez. Aun asi, el servicio vuelve a
        // verificar contra el historial antes de otorgar nada.
        if (!yaGanado) {
            await eventBus.publish('quiz.approved', {
                userId,
                quizRef: challengeId,
                quizType: 'challenge',
                score: 100,
                passed: true,
                basePoints: challenge.points_reward
            });
        }

        res.status(200).json({
            msg: yaGanado ? "Ya habías superado este desafío" : "Desafío superado con éxito",
            ya_completado: yaGanado,
            puntos_estimados: yaGanado ? 0 : challenge.points_reward
        });

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/points/:userId
 *
 * Criterio tecnico 3: retorna el total acumulado y el detalle paginado del
 * historial. El control de acceso (propio usuario, admin o rh) lo aplica el
 * middleware selfOrRoles en la definicion de la ruta.
 *
 * Query params: ?page=1&limit=20
 */
exports.getUserPoints = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

        const { rowCount } = await db.query("SELECT 1 FROM users WHERE id = $1", [userId]);
        if (rowCount === 0) return res.status(404).json({ msg: "Usuario no encontrado" });

        const resultado = await pointsService.obtenerHistorial(userId, { page, limit });
        res.status(200).json(resultado);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/points/:userId/rules
 * Reglas de puntuacion vigentes. Sirve para que el frontend muestre cuantos
 * puntos otorga cada accion sin hardcodearlos.
 */
exports.getPointsRules = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT code, source_type, points_mode, points, allow_repeat, description
               FROM points_rules WHERE is_active = true ORDER BY source_type`
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
