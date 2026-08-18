const db = require('../config/db');
const pointsService = require('../services/points.service');

/**
 * GET /api/simulations
 *
 * Faltaba por completo: existian los endpoints para crear una simulacion, sus
 * pasos y sus opciones, y para jugar una concreta por id, pero ninguno para
 * saber CUALES hay. Sin este listado, el frontend no tenia forma de mostrarlas
 * y una simulacion creada por un instructor quedaba inalcanzable: habia que
 * adivinar su id.
 *
 * Un empleado solo ve las de los cursos que tiene asignados, mas las que no
 * pertenecen a ningun curso (regla de negocio RN-01). Admin e instructor ven
 * todas, porque son quienes las administran.
 */
exports.listSimulations = async (req, res) => {
    try {
        const { id: userId, role } = req.user;
        const esGestor = role === 'admin' || role === 'instructor';

        // El conteo de pasos evita mostrar en el portal una simulacion vacia,
        // que se abriria en una pantalla sin nada que responder.
        const { rows } = await db.query(
            `SELECT s.id, s.title, s.description, s.difficulty, s.course_id,
                    c.title AS curso,
                    COUNT(st.id)::int AS pasos,
                    EXISTS (SELECT 1 FROM quiz_attempts q
                             WHERE q.user_id = $1
                               AND q.quiz_type = 'simulation'
                               AND q.quiz_ref = s.id::varchar) AS intentada
               FROM simulations s
               LEFT JOIN courses c ON c.id = s.course_id
               LEFT JOIN simulation_steps st ON st.simulation_id = s.id
              WHERE $2::boolean = true
                 OR s.course_id IS NULL
                 OR s.course_id IN (SELECT course_id FROM course_assignments WHERE user_id = $1)
              GROUP BY s.id, s.title, s.description, s.difficulty, s.course_id, c.title
             HAVING COUNT(st.id) > 0 OR $2::boolean = true
              ORDER BY s.id`,
            [userId, esGestor]
        );

        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

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

/**
 * POST /api/simulations/:simulationId/complete
 *
 * Cierra una simulacion y deja el intento registrado en quiz_attempts.
 *
 * Por que hacia falta: submitDecision otorgaba los puntos de cada opcion, pero
 * nadie escribia nunca una fila en quiz_attempts para una simulacion. O sea
 * que una simulacion terminada no existia para el resumen de desempeno, ni
 * para las recomendaciones de refuerzo, ni para la racha de evaluaciones
 * aprobadas. Solo los desafios del portal alimentaban ese historial.
 *
 * El puntaje se recalcula EN EL SERVIDOR a partir de las opciones elegidas.
 * Aceptarlo del cliente permitiria mandar {"score": 100} y aprobar sin jugar.
 *
 * No se emite quiz.approved a proposito: los puntos de una simulacion ya se
 * otorgaron opcion por opcion en submitDecision, y ese evento haria que el
 * servicio de puntos los otorgara de nuevo con la regla generica.
 */
exports.completeSimulation = async (req, res) => {
    try {
        const simulationId = Number.parseInt(req.params.simulationId, 10);
        const userId = req.user.id;
        const { decisiones } = req.body;

        if (!Array.isArray(decisiones) || decisiones.length === 0) {
            return res.status(400).json({ msg: "decisiones debe ser un arreglo con las opciones elegidas" });
        }

        const { rows: simRows } = await db.query(
            "SELECT id, title, course_id FROM simulations WHERE id = $1",
            [simulationId]
        );
        if (simRows.length === 0) return res.status(404).json({ msg: "Simulación no encontrada" });
        const simulacion = simRows[0];

        // Todas las opciones de la simulacion, con el paso al que pertenecen.
        const { rows: opciones } = await db.query(
            `SELECT o.id, o.step_id, o.is_correct, o.points_awarded
               FROM simulation_options o
               JOIN simulation_steps s ON s.id = o.step_id
              WHERE s.simulation_id = $1`,
            [simulationId]
        );

        if (opciones.length === 0) {
            return res.status(400).json({ msg: "La simulación no tiene opciones configuradas" });
        }

        const porId = new Map(opciones.map(o => [o.id, o]));
        const elegidas = decisiones.map(Number);

        // Una opcion de otra simulacion inflaria el puntaje de esta.
        const ajena = elegidas.find(id => !porId.has(id));
        if (ajena !== undefined) {
            return res.status(400).json({ msg: `La opción ${ajena} no pertenece a esta simulación` });
        }

        // Techo del puntaje: la mejor opcion de cada paso.
        const mejorPorPaso = new Map();
        for (const o of opciones) {
            const previa = mejorPorPaso.get(o.step_id) || 0;
            if (o.points_awarded > previa) mejorPorPaso.set(o.step_id, o.points_awarded);
        }
        const puntajeMaximo = [...mejorPorPaso.values()].reduce((a, b) => a + b, 0);

        const seleccionadas = elegidas.map(id => porId.get(id));
        const puntajeObtenido = seleccionadas.reduce((a, o) => a + o.points_awarded, 0);
        const aciertos = seleccionadas.filter(o => o.is_correct).length;
        const pasos = mejorPorPaso.size;

        // Si ninguna opcion otorga puntos, el porcentaje sale de los aciertos:
        // dividir por cero daria NaN y romperia el CHECK de score.
        const score = puntajeMaximo > 0
            ? Math.round(puntajeObtenido * 100 / puntajeMaximo)
            : (pasos > 0 ? Math.round(aciertos * 100 / pasos) : 0);

        const puntajeMinimo = 60;
        const aprobada = score >= puntajeMinimo;

        const { rows: attemptRows } = await db.query(
            `INSERT INTO quiz_attempts
                (user_id, quiz_ref, quiz_type, course_id, score, passing_score, passed, attempt_no)
             VALUES ($1::int, $2::varchar, 'simulation', $3::int, $4::int, $5::int, $6::boolean,
                     (SELECT COUNT(*) + 1 FROM quiz_attempts
                       WHERE user_id = $1::int AND quiz_ref = $2::varchar))
             RETURNING id, attempt_no`,
            [userId, String(simulationId), simulacion.course_id || null,
             Math.max(0, Math.min(100, score)), puntajeMinimo, aprobada]
        );

        res.status(200).json({
            simulation_id: simulationId,
            titulo: simulacion.title,
            score,
            aprobada,
            aciertos,
            pasos,
            puntaje_obtenido: puntajeObtenido,
            puntaje_maximo: puntajeMaximo,
            intento_no: attemptRows[0].attempt_no
        });

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
