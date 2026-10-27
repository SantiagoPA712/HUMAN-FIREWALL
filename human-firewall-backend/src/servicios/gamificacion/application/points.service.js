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

const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const cursos = require('../infrastructure/client/cursos.cliente');
const identidad = require('../infrastructure/client/identidad.cliente');
const { conTransaccion } = require('../infrastructure/persistence/conexion');
const { calcularPuntos } = require('../domain/puntos');
const repo = require('../infrastructure/persistence/puntos.repositorio');

/** Lee una regla activa del catalogo. */
const obtenerRegla = (code) => repo.reglaActiva(code);

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
    const movimiento = await conTransaccion(async (tx) => {
        const movimiento = await repo.insertarMovimiento(
            { userId, sourceType, sourceId, points, ruleCode, idempotencyKey }, tx
        );

        // Ya se habian otorgado estos puntos: no se duplica nada.
        if (!movimiento) return null;

        // Evento para la HU de recompensas: se encola en la misma transaccion,
        // asi que solo existe si los puntos realmente se otorgaron.
        await eventBus.publish(EVENTOS.POINTS_ASSIGNED, {
            userId,
            sourceType,
            sourceId: movimiento.source_id,
            points: movimiento.points,
            ledgerId: movimiento.id
        }, tx);

        return movimiento;
    });

    // La cache de puntos vive en la cuenta (identidad): se le manda el total
    // recalculado desde el historial, no un incremento. Va despues del commit
    // porque es otra base; si fallara, el siguiente movimiento la corrige.
    if (movimiento) await identidad.guardarCacheDePuntos(userId, await repo.totalDe(userId));
    return movimiento;
}

/**
 * Criterio de aceptacion 1: puntos al completar una leccion.
 * Si la leccion define su propio points_reward, ese valor manda sobre el de
 * la regla general.
 */
async function asignarPuntosPorLeccion({ userId, contentId }) {
    const regla = await obtenerRegla('lesson.completed');
    if (!regla) return null;

    // La leccion es del servicio de cursos: se le pregunta por su contrato
    // en lugar de leer course_contents directamente.
    const leccion = await cursos.obtenerLeccion(contentId);
    if (!leccion) {
        throw new Error(`La leccion ${contentId} no existe`);
    }

    const puntos = leccion.points_reward != null ? leccion.points_reward : regla.points;

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
        if (await repo.yaCobroEvaluacion(userId, quizRef)) return null;   // ya cobro esta evaluacion
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
    return repo.existeClave(idempotencyKey);
}

/**
 * Totales de puntos de varios usuarios de una sola consulta, opcionalmente
 * acotados a un rango de fechas.
 *
 * Existe por los reportes de RH. Ese modulo necesita los puntos de una pagina
 * entera de usuarios; llamando a obtenerHistorial() por cada uno serian N+1
 * consultas para una tabla de 50 filas.
 *
 * La alternativa era que el modulo de reportes leyera points_ledger por su
 * cuenta, y eso es justo lo que prohibe su criterio tecnico 3: los puntos se
 * piden a este servicio, que es el dueno del historial.
 *
 * Con rango de fechas NO se puede usar v_user_points: esa vista suma el
 * historial completo. Se agrega sobre points_ledger, que es la misma fuente
 * de verdad que alimenta a la vista.
 *
 * @param {number[]} userIds
 * @param {object}   [rango]
 * @param {string}   [rango.from]  ISO 8601, inclusive
 * @param {string}   [rango.to]    ISO 8601, inclusive
 * @returns {Promise<Map<number, {total: number, movimientos: number, ultimo: Date|null}>>}
 */
async function obtenerTotalesPorUsuarios(userIds, { from = null, to = null } = {}) {
    const resultado = new Map();
    if (!Array.isArray(userIds) || userIds.length === 0) return resultado;

    const rows = await repo.totalesPorUsuarios(userIds, { from, to });

    for (const r of rows) {
        resultado.set(r.user_id, { total: r.total, movimientos: r.movimientos, ultimo: r.ultimo });
    }
    return resultado;
}

/** Total y detalle paginado del historial de un usuario. */
async function obtenerHistorial(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const [totales, historial] = await Promise.all([
        repo.resumenDe(userId),
        repo.movimientosDe(userId, { limit, offset })
    ]);

    const resumen = totales || { total_points: 0, movimientos: 0, ultimo_movimiento: null };

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
        historial
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
    obtenerTotalesPorUsuarios,
    obtenerHistorial,
    registrarHandlers
};
