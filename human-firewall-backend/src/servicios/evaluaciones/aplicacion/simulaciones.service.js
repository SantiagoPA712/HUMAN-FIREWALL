/**
 * Casos de uso de las simulaciones.
 *
 * Capa de aplicacion: coordina repositorio, reglas de dominio, clientes de
 * otros servicios y eventos. No conoce HTTP.
 */

const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { ErrorHttp } = require('../../../compartido/http/errores');
const repo = require('../infraestructura/evaluaciones.repositorio');
const cursos = require('../infraestructura/clientes/cursos.cliente');
const gamificacion = require('../infraestructura/clientes/gamificacion.cliente');
const { calcularResultadoSimulacion, ReglaDeEvaluacion, PUNTAJE_MINIMO, acotar } = require('../dominio/puntaje');

const ROLES_GESTORES = ['admin', 'instructor'];

/**
 * Simulaciones disponibles para el usuario (regla de negocio RN-01): un
 * empleado ve las de sus cursos asignados y las que no pertenecen a ningun
 * curso; admin e instructor ven todas.
 *
 * Antes era un solo SELECT con JOIN a courses y course_assignments, tablas
 * del servicio de cursos. Ahora los cursos asignados y sus titulos se piden
 * por el contrato de cursos, y el SQL solo toca tablas propias.
 */
async function listarDisponibles({ id: userId, role }) {
    const esGestor = ROLES_GESTORES.includes(role);
    const cursosPermitidos = esGestor ? [] : await cursos.idsDeCursosAsignados(userId);

    const filas = await repo.listarSimulaciones({ userId, esGestor, cursosPermitidos });

    const titulos = new Map(
        (await cursos.obtenerTitulos(filas.map(f => f.course_id))).map(c => [c.id, c.title])
    );

    return filas.map(f => ({
        id: f.id,
        title: f.title,
        description: f.description,
        difficulty: f.difficulty,
        course_id: f.course_id,
        curso: f.course_id ? titulos.get(f.course_id) ?? null : null,
        pasos: f.pasos,
        intentada: f.intentada
    }));
}

async function crearSimulacion({ title, description, difficulty }, createdBy) {
    return repo.insertarSimulacion({ title, description, difficulty: difficulty || 'beginner', createdBy });
}

async function agregarPaso(simulationId, { scenario_text, order_idx }) {
    return repo.insertarPaso({ simulationId, scenarioText: scenario_text, orderIdx: order_idx || 1 });
}

async function agregarOpcion(stepId, { option_text, is_correct, points_awarded, feedback_text }) {
    return repo.insertarOpcion({
        stepId,
        optionText: option_text,
        isCorrect: is_correct,
        pointsAwarded: points_awarded || 0,
        feedbackText: feedback_text
    });
}

async function obtenerDetalle(simulationId) {
    const simulacion = await repo.buscarSimulacion(simulationId);
    if (!simulacion) throw ErrorHttp.noEncontrado('Simulación no encontrada');

    const pasos = await repo.listarPasos(simulationId);
    const steps = await Promise.all(pasos.map(async (paso) => ({
        ...paso,
        options: await repo.listarOpcionesDePaso(paso.id)
    })));

    return { ...simulacion, steps };
}

/**
 * Registra una decision. Los puntos NO se otorgan aca: se publica
 * simulation.decision_made y los otorga gamificacion. Por eso la respuesta
 * trae puntos_estimados.
 */
async function registrarDecision(optionId, userId) {
    const opcion = await repo.buscarOpcion(optionId);
    if (!opcion) throw ErrorHttp.noEncontrado('Opción no encontrada');

    // El payload del evento tiene que bastarse solo: un suscriptor no deberia
    // volver a la base a reconstruir el contexto de algo que ya paso.
    const simulationId = await repo.simulacionDePaso(opcion.step_id);

    const yaContabilizada = opcion.points_awarded > 0
        && await gamificacion.yaOtorgado(`simulation:${userId}:${opcion.id}`);

    if (opcion.points_awarded > 0 && !yaContabilizada) {
        await eventBus.publish(EVENTOS.SIMULATION_DECISION_MADE, {
            userId,
            optionId: opcion.id,
            simulationId,
            stepId: opcion.step_id,
            isCorrect: opcion.is_correct,
            points: opcion.points_awarded
        });
    }

    return {
        is_correct: opcion.is_correct,
        feedback: opcion.feedback_text,
        puntos_estimados: yaContabilizada ? 0 : opcion.points_awarded,
        ya_contabilizada: yaContabilizada
    };
}

/**
 * Cierra una simulacion: calcula el puntaje en el servidor, registra el
 * intento y publica simulation.completed (un evento PROPIO y no
 * quiz.approved, porque los puntos ya se pagaron decision por decision).
 */
async function completar(simulationId, userId, decisiones) {
    const simulacion = await repo.buscarSimulacion(simulationId);
    if (!simulacion) throw ErrorHttp.noEncontrado('Simulación no encontrada');

    let resultado;
    try {
        resultado = calcularResultadoSimulacion(await repo.opcionesDeSimulacion(simulationId), decisiones);
    } catch (e) {
        if (e instanceof ReglaDeEvaluacion) throw new ErrorHttp(400, e.message, { codigo: 'VALIDACION' });
        throw e;
    }

    const intento = await repo.registrarIntento({
        userId,
        quizRef: simulationId,
        quizType: 'simulation',
        courseId: simulacion.course_id,
        score: acotar(resultado.score),
        passingScore: PUNTAJE_MINIMO,
        passed: resultado.aprobada
    });

    // El evento va DESPUES de que el intento quedo escrito: un suscriptor que
    // consulte quiz_attempts tiene que encontrar la fila que anuncia.
    await eventBus.publish(EVENTOS.SIMULATION_COMPLETED, {
        userId,
        simulationId,
        courseId: simulacion.course_id || null,
        score: resultado.score,
        aprobada: resultado.aprobada,
        aciertos: resultado.aciertos,
        pasos: resultado.pasos,
        attemptId: intento.id,
        attemptNo: intento.attempt_no
    });

    return {
        simulation_id: simulationId,
        titulo: simulacion.title,
        score: resultado.score,
        aprobada: resultado.aprobada,
        aciertos: resultado.aciertos,
        pasos: resultado.pasos,
        puntaje_obtenido: resultado.puntajeObtenido,
        puntaje_maximo: resultado.puntajeMaximo,
        intento_no: intento.attempt_no
    };
}

module.exports = {
    listarDisponibles,
    crearSimulacion,
    agregarPaso,
    agregarOpcion,
    obtenerDetalle,
    registrarDecision,
    completar
};
