/**
 * Servicio de evaluaciones — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 */

const manifiesto = require('./manifiesto');
const repo = require('./infraestructura/evaluaciones.repositorio');

module.exports = {
    manifiesto,

    /** Contrato publico (OpenAPI) de la API HTTP del servicio. */
    contrato: () => require('./contrato/openapi'),

    rutas: () => [
        { prefijo: '/api/simulations', router: require('./api/simulation.routes') },
        { prefijo: '/api/gamification/challenge', router: require('./api/desafios.routes') }
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
    ultimosResultados: (userId, limite) => repo.ultimosResultados(userId, limite)
};
