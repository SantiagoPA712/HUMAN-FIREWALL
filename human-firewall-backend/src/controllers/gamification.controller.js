const db = require('../config/db');

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

exports.completeChallenge = async (req, res) => {
    try {
        const { challengeId } = req.body;
        const userId = req.user.id;

        if (!challengeId) return res.status(400).json({ msg: "El ID del desafío es obligatorio" });

        const { rows: challengeRows } = await db.query(
            "SELECT * FROM challenges WHERE id = $1", [challengeId]
        );

        if (challengeRows.length === 0) return res.status(404).json({ msg: "Desafío remoto no encontrado" });

        const challenge = challengeRows[0];

        try {
            await db.query(
                "INSERT INTO user_challenge_results (user_id, challenge_id, won) VALUES ($1, $2, true)",
                [userId, challengeId]
            );
            
            await db.query(
                "UPDATE users SET total_points = total_points + $1 WHERE id = $2",
                [challenge.points_reward, userId]
            );

            res.status(200).json({
                msg: "Desafío superado con éxito", 
                points_earned: challenge.points_reward
            });

        } catch (dbError) {
            if (dbError.code === '23505') { // Postgres Unique Violation
                return res.status(400).json({ msg: "Ya cobraste los puntos de este desafío." });
            }
            throw dbError;
        }

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
