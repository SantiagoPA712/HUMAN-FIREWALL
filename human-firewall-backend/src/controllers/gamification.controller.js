const db = require('../config/db');
const pointsService = require('../services/points.service');
const eventBus = require('../services/eventBus');
const rewardsService = require('../services/rewards.service');
const levelsService = require('../services/levels.service');
const recommendationsService = require('../services/recommendations.service');

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

        // Los datos salen del snapshot guardado en user_rewards, no del
        // catalogo: asi la respuesta no cambia si la recompensa se edito o se
        // elimino despues de otorgarse.
        const { rows: badgeRows } = await db.query(`
            SELECT reward_name AS name, reward_description AS description,
                   reward_icon_url AS icon_url, earned_at
            FROM user_rewards
            WHERE user_id = $1
            ORDER BY earned_at DESC
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
        const {
            name, description, icon_url,
            condition_type = 'points_total',
            threshold,
            points_required,
            is_repeatable = false
        } = req.body;

        if (!name) return res.status(400).json({ msg: "El nombre de la insignia es obligatorio" });

        // points_required se sigue aceptando por compatibilidad con el cliente
        // viejo, pero internamente ya es un parametro de condicion mas.
        const umbral = threshold != null ? threshold : (points_required || 0);

        const { rows } = await db.query(
            `INSERT INTO rewards_catalog
                (name, description, icon_url, condition_type, condition_params, is_repeatable, points_required)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [name, description, icon_url, condition_type,
             JSON.stringify({ threshold: umbral }), is_repeatable, umbral]
        );

        res.status(201).json(rows[0]);
    } catch (error) {
        if (error.code === '23514') {
            return res.status(400).json({ msg: "Tipo de condicion no valido" });
        }
        res.status(500).json({ msg: error.message });
    }
};

exports.assignBadge = async (req, res) => {
    try {
        // badge_id se mantiene como alias por compatibilidad.
        const { user_id, reward_id, badge_id } = req.body;
        const recompensaId = reward_id || badge_id;

        if (!user_id || !recompensaId) {
            return res.status(400).json({ msg: "user_id y reward_id son obligatorios" });
        }

        const { rows: catalogo } = await db.query(
            "SELECT * FROM rewards_catalog WHERE id = $1",
            [recompensaId]
        );
        if (catalogo.length === 0) {
            return res.status(404).json({ msg: "Recompensa no encontrada en el catalogo" });
        }

        // Se otorga por el mismo camino que el motor automatico, para que la
        // asignacion manual tambien quede con snapshot y sin duplicados.
        const otorgada = await rewardsService.otorgarRecompensa({
            recompensa: catalogo[0],
            userId: user_id,
            sourceType: 'manual',
            sourceId: req.user.id,
            valorAlcanzado: null
        });

        if (!otorgada) {
            return res.status(200).json({ msg: "El usuario ya tiene esta insignia" });
        }

        res.status(201).json({ msg: "Insignia asignada exitosamente", data: otorgada });
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
    const client = await db.connect();

    try {
        const { challengeId, passed, score } = req.body;
        const userId = req.user.id;

        if (!challengeId) return res.status(400).json({ msg: "El ID del desafío es obligatorio" });

        // FALLO CORREGIDO: este endpoint escribia score=100 y passed=true fijos,
        // sin mirar como le habia ido al usuario. Consecuencias:
        //   1. Un intento reprobado no se podia registrar de ninguna manera, asi
        //      que quiz_attempts.passed nunca valia false. Las areas de
        //      oportunidad y las recomendaciones de refuerzo, que se calculan
        //      justamente sobre eso, no tenian de donde salir.
        //   2. Peor: el juego de ingenieria social llamaba a este endpoint
        //      tambien al perder, y como el resultado venia fijo, caer en la
        //      estafa otorgaba los mismos puntos que detectarla.
        //
        // El resultado ahora viene del cliente. `passed` se acepta como
        // opcional y por defecto true para no romper a un cliente viejo que no
        // lo mande, pero las cinco pantallas del portal ya envian el real.
        const aprobado = passed !== false;
        const puntaje = Number.isInteger(score)
            ? Math.max(0, Math.min(100, score))
            : (aprobado ? 100 : 0);

        const { rows: challengeRows } = await client.query(
            "SELECT * FROM challenges WHERE id = $1", [challengeId]
        );
        if (challengeRows.length === 0) return res.status(404).json({ msg: "Desafío no encontrado" });

        const challenge = challengeRows[0];

        // Todo dentro de una transaccion: el registro del desafio, el intento y
        // el encolado del evento se confirman juntos o no se confirma ninguno.
        //
        // Sin esto, si una de las escrituras falla, la fila de
        // user_challenge_results queda igual y su UNIQUE bloquea el reintento:
        // el usuario pierde los puntos de forma definitiva y en silencio.
        await client.query('BEGIN');

        // Solo un desafio superado se marca como ganado. Un fallo queda
        // unicamente en el historial de intentos, para que el usuario pueda
        // volver a intentarlo y ganarlo despues.
        let yaGanado = false;

        if (aprobado) {
            const { rows: nuevas } = await client.query(
                `INSERT INTO user_challenge_results (user_id, challenge_id, won)
                 VALUES ($1, $2, true)
                 ON CONFLICT (user_id, challenge_id) DO NOTHING
                 RETURNING id`,
                [userId, challengeId]
            );
            yaGanado = nuevas.length === 0;
        }

        // El intento SIEMPRE se registra, se haya ganado o perdido: es la
        // materia prima del resumen de desempeno y de las recomendaciones.
        //
        // Los tipos van explicitos: $1 y $2 se usan en el VALUES y en la
        // subconsulta, y sin cast Postgres deduce tipos distintos en cada
        // contexto y rechaza la consulta.
        await client.query(
            `INSERT INTO quiz_attempts (user_id, quiz_ref, quiz_type, course_id, score, passing_score, passed, attempt_no)
             VALUES ($1::int, $2::varchar, 'challenge', $3::int, $4::int, 60, $5::boolean,
                     (SELECT COUNT(*) + 1 FROM quiz_attempts
                       WHERE user_id = $1::int AND quiz_ref = $2::varchar))`,
            [userId, challengeId, challenge.course_id || null, puntaje, aprobado]
        );

        // Criterio de aceptacion 2 de la HU de puntos: no se asignan puntos si
        // el intento fue reprobado. El evento solo se emite al aprobar.
        if (aprobado && !yaGanado) {
            await eventBus.publish('quiz.approved', {
                userId,
                quizRef: challengeId,
                quizType: 'challenge',
                score: puntaje,
                passed: true,
                basePoints: challenge.points_reward
            }, client);
        }

        await client.query('COMMIT');

        res.status(200).json({
            msg: !aprobado
                ? "Intento registrado: esta vez no lo superaste"
                : yaGanado ? "Ya habías superado este desafío" : "Desafío superado con éxito",
            aprobado,
            score: puntaje,
            ya_completado: yaGanado,
            puntos_estimados: (aprobado && !yaGanado) ? challenge.points_reward : 0
        });

    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        res.status(500).json({ msg: error.message });
    } finally {
        client.release();
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

/**
 * GET /api/gamification/rewards/:userId
 *
 * Criterio tecnico 4: recompensas obtenidas por el usuario, con las mismas
 * reglas de acceso por rol que el resto del modulo. El control lo aplica
 * selfOrRoles en la definicion de la ruta.
 *
 * Devuelve tambien las bloqueadas, con el progreso hacia cada una, para la
 * galeria de logros.
 */
exports.getUserRewards = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        const { rowCount } = await db.query("SELECT 1 FROM users WHERE id = $1", [userId]);
        if (rowCount === 0) return res.status(404).json({ msg: "Usuario no encontrado" });

        const resultado = await rewardsService.obtenerRecompensasDeUsuario(userId);
        res.status(200).json(resultado);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/level/:userId
 *
 * Criterio tecnico 2: calcula el nivel a partir del total de puntos derivado
 * de points_ledger y devuelve nivel actual, puntos actuales, puntos para el
 * siguiente nivel y porcentaje de avance.
 *
 * Criterio de aceptacion 3 / criterio tecnico 4: el 403 ante el nivel de otro
 * usuario lo aplica selfOrRoles en la definicion de la ruta, igual que en el
 * endpoint de puntos.
 */
exports.getUserLevel = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        const { rowCount } = await db.query("SELECT 1 FROM users WHERE id = $1", [userId]);
        if (rowCount === 0) return res.status(404).json({ msg: "Usuario no encontrado" });

        const resultado = await levelsService.obtenerNivelDeUsuario(userId);
        res.status(200).json(resultado);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/performance/:userId
 *
 * Criterio tecnico 1: agrega quiz_attempts y lesson_progress del usuario para
 * armar el resumen de desempeno, las areas de oportunidad y las
 * recomendaciones de refuerzo.
 *
 * Criterio tecnico 3: mismas reglas de acceso que el resto del modulo. El 403
 * lo aplica selfOrRoles en la definicion de la ruta; el servicio, ademas,
 * filtra siempre por el user_id recibido, asi que no hay forma de que se
 * cuelen datos de otro usuario.
 */
exports.getUserPerformance = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        const { rowCount } = await db.query("SELECT 1 FROM users WHERE id = $1", [userId]);
        if (rowCount === 0) return res.status(404).json({ msg: "Usuario no encontrado" });

        const resultado = await recommendationsService.obtenerResumenDesempeno(userId);
        res.status(200).json(resultado);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/levels
 * Escalera completa de niveles. Permite mostrar todos los tramos sin
 * hardcodear los umbrales en el frontend.
 */
exports.getLevelsConfig = async (req, res) => {
    try {
        const escalera = await levelsService.obtenerEscalera();
        res.status(200).json(escalera);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/rewards
 * Catalogo completo de recompensas activas.
 */
exports.getRewardsCatalog = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, name, description, icon_url, condition_type,
                    condition_params, is_repeatable
               FROM rewards_catalog
              WHERE is_active = true
              ORDER BY condition_type, id`
        );
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
