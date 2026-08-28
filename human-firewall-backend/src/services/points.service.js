/**
 * Servicio de asignacion automatica de puntos.
 *
 * Consume los eventos lesson.completed, quiz.approved y course.completed, y
 * aplica las reglas definidas en la tabla points_rules (criterio tecnico 4:
 * las reglas son configurables, no estan hardcodeadas).
 *
 * Toda asignacion termina en un INSERT en points_ledger, que es un historial
 * inmutable. users.total_points queda como cache derivada de ese historial.
 */

const db = require('../config/db');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');

/** Lee una regla activa del catalogo. */
async function obtenerRegla(code) {
    const { rows } = await db.query(
        `SELECT code, source_type, points_mode, points, allow_repeat, is_active
           FROM points_rules
          WHERE code = $1 AND is_active = true`,
        [code]
    );
    return rows[0] || null;
}

/** Calcula cuantos puntos otorga una regla para un puntaje dado. */
function calcularPuntos(regla, score) {
    if (regla.points_mode === 'by_score') {
        const s = Math.max(0, Math.min(100, Number(score) || 0));
        return Math.round(regla.points * s / 100);
    }
    return regla.points;
}

/**
 * Inserta un movimiento en el historial y actualiza la cache de total_points.
 *
 * Es idempotente: si ya existe un movimiento con la misma idempotency_key, no
 * inserta nada y devuelve null. Esto es lo que evita que un reintento de la
 * cola de eventos duplique los puntos.
 *
 * @returns {Promise<object|null>} el movimiento insertado, o null si ya existia
 */
async function registrarMovimiento({ userId, sourceType, sourceId, points, ruleCode, idempotencyKey }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `INSERT INTO points_ledger (user_id, source_type, source_id, points, rule_code, idempotency_key)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id, user_id, source_type, source_id, points, rule_code, created_at`,
            [userId, sourceType, sourceId != null ? String(sourceId) : null, points, ruleCode, idempotencyKey]
        );

        // Ya se habian otorgado estos puntos: no se duplica nada.
        if (rows.length === 0) {
            await client.query('COMMIT');
            return null;
        }

        const movimiento = rows[0];

        // La cache se recalcula desde el historial en vez de incrementarse, para
        // que no pueda desincronizarse de la fuente de verdad.
        await client.query(
            `UPDATE users
                SET total_points = (SELECT COALESCE(SUM(points), 0) FROM points_ledger WHERE user_id = $1)
              WHERE id = $1`,
            [userId]
        );

        // Evento para la HU de recompensas: se encola en la misma transaccion,
        // asi que solo existe si los puntos realmente se otorgaron.
        await eventBus.publish(EVENTOS.POINTS_ASSIGNED, {
            userId,
            sourceType,
            sourceId: movimiento.source_id,
            points: movimiento.points,
            ledgerId: movimiento.id
        }, client);

        await client.query('COMMIT');
        return movimiento;

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Criterio de aceptacion 1: puntos al completar una leccion.
 * Si la leccion define su propio points_reward, ese valor manda sobre el de
 * la regla general.
 */
async function asignarPuntosPorLeccion({ userId, contentId }) {
    const regla = await obtenerRegla('lesson.completed');
    if (!regla) return null;

    const { rows } = await db.query(
        `SELECT points_reward FROM course_contents WHERE id = $1`,
        [contentId]
    );
    if (rows.length === 0) {
        throw new Error(`La leccion ${contentId} no existe`);
    }

    const puntos = rows[0].points_reward != null ? rows[0].points_reward : regla.points;

    return registrarMovimiento({
        userId,
        sourceType: 'lesson',
        sourceId: contentId,
        points: puntos,
        ruleCode: regla.code,
        idempotencyKey: `lesson:${userId}:${contentId}`
    });
}

/**
 * Criterio de aceptacion 2: puntos al aprobar una evaluacion.
 *  - Si el intento fue reprobado, no se asigna nada.
 *  - Los puntos son proporcionales al puntaje cuando la regla es 'by_score'.
 *  - Si la evaluacion ya fue aprobada antes y la regla no permite repetir,
 *    no se duplican los puntos.
 */
async function asignarPuntosPorQuiz({ userId, quizRef, quizType, score, passed, attemptNo = 1, basePoints = null }) {
    if (!passed) return null;

    const regla = await obtenerRegla('quiz.approved');
    if (!regla) return null;

    // Los desafios traen su propia recompensa en challenges.points_reward.
    // Se usa como base en lugar del valor generico de la regla.
    const reglaEfectiva = basePoints != null ? { ...regla, points: basePoints } : regla;

    if (!regla.allow_repeat) {
        // rows.length y no rowCount: en un SELECT son lo mismo con node-postgres,
        // pero PGlite (el motor de las pruebas) no expone rowCount, y con
        // rowCount esta guarda quedaba en undefined > 0 = false. O sea: la
        // proteccion funcionaba en produccion y NINGUNA prueba la ejercitaba.
        const { rows: yaCobrado } = await db.query(
            `SELECT 1 FROM points_ledger
              WHERE user_id = $1 AND source_type = 'quiz' AND source_id = $2
              LIMIT 1`,
            [userId, String(quizRef)]
        );
        if (yaCobrado.length > 0) return null;   // ya cobro esta evaluacion
    }

    const puntos = calcularPuntos(reglaEfectiva, score);
    if (puntos <= 0) return null;

    // Si la regla permite repetir, cada intento necesita su propia clave.
    const clave = regla.allow_repeat
        ? `quiz:${userId}:${quizRef}:${attemptNo}`
        : `quiz:${userId}:${quizRef}`;

    return registrarMovimiento({
        userId,
        sourceType: 'quiz',
        sourceId: quizRef,
        points: puntos,
        ruleCode: regla.code,
        idempotencyKey: clave
    });
}

/** Puntos por finalizar un curso completo. */
async function asignarPuntosPorCurso({ userId, courseId }) {
    const regla = await obtenerRegla('course.completed');
    if (!regla) return null;

    return registrarMovimiento({
        userId,
        sourceType: 'course',
        sourceId: courseId,
        points: regla.points,
        ruleCode: regla.code,
        idempotencyKey: `course:${userId}:${courseId}`
    });
}

/**
 * Puntos por una decision dentro de una simulacion.
 *
 * Antes esto no pasaba por el bus: simulation.controller llamaba directo a
 * registrarMovimiento dentro del request. Funcionaba, pero acoplaba el modulo
 * de simulaciones al de puntos: la pantalla no podia responder hasta que el
 * ledger estuviera escrito, y cualquier regla nueva sobre una decision
 * (recompensas, avisos) obligaba a editar el controlador de simulaciones.
 *
 * El valor NO sale de la regla: points_rules.simulation.step tiene points = 0
 * porque cada opcion define su propia recompensa en simulation_options. La
 * regla se consulta igual, para respetar el criterio de que se pueda apagar
 * la asignacion desde la base sin tocar codigo (is_active = false).
 */
async function asignarPuntosPorDecisionSimulacion({ userId, optionId, points }) {
    const regla = await obtenerRegla('simulation.step');
    if (!regla) return null;

    const puntos = points != null ? points : regla.points;
    if (puntos <= 0) return null;

    return registrarMovimiento({
        userId,
        sourceType: 'simulation',
        sourceId: optionId,
        points: puntos,
        ruleCode: regla.code,
        // Misma clave que usaba la version sincrona: los puntos que ya se
        // otorgaron antes de este cambio siguen contando como otorgados, y un
        // reintento del worker no los duplica.
        idempotencyKey: `simulation:${userId}:${optionId}`
    });
}

/**
 * Consulta si una clave de idempotencia ya cobro.
 *
 * Existe para que otros modulos puedan RESPONDER "esto ya te lo pague" sin
 * escribir SQL sobre points_ledger, que es tabla de este servicio. Es una
 * consulta, no un comando: los modulos se leen entre si, pero solo se
 * modifican a traves de eventos.
 */
async function yaOtorgado(idempotencyKey) {
    const { rows } = await db.query(
        `SELECT 1 FROM points_ledger WHERE idempotency_key = $1 LIMIT 1`,
        [idempotencyKey]
    );
    return rows.length > 0;
}

/** Total y detalle paginado del historial de un usuario. */
async function obtenerHistorial(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const [totales, detalle] = await Promise.all([
        db.query(
            `SELECT total_points, movimientos, ultimo_movimiento
               FROM v_user_points WHERE user_id = $1`,
            [userId]
        ),
        db.query(
            `SELECT id, source_type, source_id, points, rule_code, created_at
               FROM points_ledger
              WHERE user_id = $1
              ORDER BY created_at DESC, id DESC
              LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        )
    ]);

    const resumen = totales.rows[0] || { total_points: 0, movimientos: 0, ultimo_movimiento: null };

    return {
        user_id: userId,
        total_points: resumen.total_points,
        movimientos: resumen.movimientos,
        ultimo_movimiento: resumen.ultimo_movimiento,
        paginacion: {
            page,
            limit,
            total_paginas: Math.max(1, Math.ceil(resumen.movimientos / limit))
        },
        historial: detalle.rows
    };
}

/**
 * Conecta el servicio al bus. Se llama una sola vez al arrancar el servidor.
 */
function registrarHandlers() {
    eventBus.subscribe(EVENTOS.LESSON_COMPLETED, p => asignarPuntosPorLeccion(p));
    eventBus.subscribe(EVENTOS.QUIZ_APPROVED,    p => asignarPuntosPorQuiz(p));
    eventBus.subscribe(EVENTOS.COURSE_COMPLETED, p => asignarPuntosPorCurso(p));
    eventBus.subscribe(EVENTOS.SIMULATION_DECISION_MADE, p => asignarPuntosPorDecisionSimulacion(p));

    // simulation.completed NO se escucha aca a proposito: los puntos de una
    // simulacion ya se otorgaron opcion por opcion. Sumar tambien al cerrarla
    // seria pagar dos veces el mismo trabajo.
    console.log('[points.service] handlers registrados');
}

module.exports = {
    obtenerRegla,
    calcularPuntos,
    registrarMovimiento,
    asignarPuntosPorLeccion,
    asignarPuntosPorQuiz,
    asignarPuntosPorCurso,
    asignarPuntosPorDecisionSimulacion,
    yaOtorgado,
    obtenerHistorial,
    registrarHandlers
};
