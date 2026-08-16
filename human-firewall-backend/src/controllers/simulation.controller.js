const db = require('../config/db');
const pointsService = require('../services/points.service');

exports.createSimulation = async (req, res) => {
    try {
        const { title, description, difficulty } = req.body;
        const created_by = req.user.id;

        if (!title) return res.status(400).json({ msg: "El título es obligatorio" });

        const { rows } = await db.query(
            "INSERT INTO simulations (title, description, difficulty, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
            [title, description, difficulty || 'beginner', created_by]
        );

        res.status(201).json(rows[0]);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.addStep = async (req, res) => {
    try {
        const { simulationId } = req.params;
        const { scenario_text, order_idx } = req.body;

        const { rows } = await db.query(
            "INSERT INTO simulation_steps (simulation_id, scenario_text, order_idx) VALUES ($1, $2, $3) RETURNING *",
            [simulationId, scenario_text, order_idx || 1]
        );

        res.status(201).json(rows[0]);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.addOption = async (req, res) => {
    try {
        const { stepId } = req.params;
        const { option_text, is_correct, points_awarded, feedback_text } = req.body;

        const { rows } = await db.query(
            "INSERT INTO simulation_options (step_id, option_text, is_correct, points_awarded, feedback_text) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [stepId, option_text, is_correct, points_awarded || 0, feedback_text]
        );

        res.status(201).json(rows[0]);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.getSimulationDetails = async (req, res) => {
    try {
        const { simulationId } = req.params;

        const { rows: simRows } = await db.query("SELECT * FROM simulations WHERE id = $1", [simulationId]);
        if (simRows.length === 0) return res.status(404).json({ msg: "Simulación no encontrada" });

        const { rows: stepRows } = await db.query("SELECT * FROM simulation_steps WHERE simulation_id = $1 ORDER BY order_idx ASC", [simulationId]);

        // Traer opciones
        const steps = await Promise.all(stepRows.map(async (step) => {
            const { rows: optRows } = await db.query("SELECT * FROM simulation_options WHERE step_id = $1", [step.id]);
            return {
                ...step,
                options: optRows
            };
        }));

        res.status(200).json({
            ...simRows[0],
            steps: steps
        });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * POST /api/simulations/decision
 *
 * FALLO CORREGIDO: la version anterior hacia
 *     UPDATE users SET total_points = total_points + X
 * sin registrar el intento. Reenviando el mismo optionId N veces se podian
 * sumar puntos ilimitados. Ahora cada opcion otorga puntos una sola vez por
 * usuario, garantizado por la idempotency_key del historial.
 */
exports.submitDecision = async (req, res) => {
    try {
        const { optionId } = req.body;
        const userId = req.user.id;

        if (!optionId) return res.status(400).json({ msg: "optionId es obligatorio" });

        const { rows: optRows } = await db.query(
            "SELECT * FROM simulation_options WHERE id = $1",
            [optionId]
        );
        if (optRows.length === 0) return res.status(404).json({ msg: "Opción no encontrada" });

        const option = optRows[0];
        let puntosOtorgados = 0;

        if (option.points_awarded > 0) {
            const movimiento = await pointsService.registrarMovimiento({
                userId,
                sourceType: 'simulation',
                sourceId: option.id,
                points: option.points_awarded,
                ruleCode: 'simulation.step',
                // Una opcion concreta paga una sola vez por usuario.
                idempotencyKey: `simulation:${userId}:${option.id}`
            });

            // null significa que ya habia cobrado esta opcion antes.
            puntosOtorgados = movimiento ? movimiento.points : 0;
        }

        res.status(200).json({
            is_correct: option.is_correct,
            feedback: option.feedback_text,
            points_earned: puntosOtorgados,
            ya_contabilizada: option.points_awarded > 0 && puntosOtorgados === 0
        });

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
