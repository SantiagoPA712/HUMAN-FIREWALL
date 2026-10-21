/**
 * Servicio de evaluaciones — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 */

const manifiesto = require('./manifiesto');
const repo = require('./infrastructure/persistence/evaluaciones.repositorio');

module.exports = {
    manifiesto,

    /** Contrato publico (OpenAPI) de la API HTTP del servicio. */
    contrato: () => require('./contract/openapi'),

    rutas: () => [
        { prefijo: '/api/simulations', router: require('./controller/simulation.routes') },
        { prefijo: '/api/gamification/challenge', router: require('./controller/desafios.routes') }
    ],

    registrarHandlers() {},
    iniciarProcesos() {},
    detenerProcesos() {},

    // --- Consultas para otros servicios ---

    /** Nombre legible de un desafio, o null. */
    nombreDeDesafio: (quizRef) => repo.nombreDeDesafio(quizRef),
    /** Titulo de una simulacion, o null. */
    tituloDeSimulacion: (id) => repo.tituloDeSimulacion(id),
    /** Cuantas evaluaciones distintas aprobo el usuario. */
    contarEvaluacionesAprobadas: (userId) => repo.contarEvaluacionesAprobadas(userId),
    /** passed de los ultimos intentos, del mas reciente al mas viejo. */
    ultimosResultados: (userId, limite) => repo.ultimosResultados(userId, limite),

    // Consultas de lectura para gamificacion y reportes (base de datos por
    // servicio: nadie mas hace JOIN con las tablas de evaluaciones).
    resultadosConsolidados: (...args) => repo.resultadosConsolidados(...args),
    pendientesDe: (...args) => repo.pendientesDe(...args),
    serieDeIntentos: (...args) => repo.serieDeIntentos(...args),
    accionesPorUsuarioEntre: (...args) => repo.intentosPorUsuarioEntre(...args),
    ultimaActividadDe: (...args) => repo.ultimoIntentoDe(...args)
};
