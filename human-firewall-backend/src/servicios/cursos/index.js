/**
 * Servicio de cursos — puerta de entrada publica.
 *
 * Este archivo ES el contrato interno del servicio: lo unico que otro
 * servicio puede usar. Nadie de afuera importa controller/, application/ ni
 * infrastructure/ (lo verifica tests/arquitectura.test.mjs). Los demas
 * servicios llegan aca a traves de su propio cliente, en
 * <su-servicio>/infrastructure/client/cursos.cliente.js.
 *
 * Si mañana cursos se desplegara como un proceso aparte, este objeto pasaria
 * a ser una API HTTP interna y solo cambiarian esos clientes.
 */

const manifiesto = require('./manifiesto');
const cursos = require('./application/cursos.service');

module.exports = {
    manifiesto,

    /** Contrato publico (OpenAPI) de la API HTTP del servicio. */
    contrato: () => require('./contract/openapi'),

    /** Routers HTTP que app.js monta. */
    rutas: () => [{ prefijo: '/api/courses', router: require('./controller/course.routes') }],

    /** Suscripciones al bus: este servicio no consume eventos. */
    registrarHandlers() {},

    /** Procesos de fondo: el reloj que publica course.deadline_approaching. */
    iniciarProcesos() { cursos.iniciarRelojDeVencimientos(); },
    detenerProcesos() { cursos.detenerRelojDeVencimientos(); },

    // --- Consultas y comandos para otros servicios ---
    obtenerTitulo: (...args) => cursos.obtenerTitulo(...args),
    obtenerTitulos: (...args) => cursos.obtenerTitulos(...args),
    idsDeCursosAsignados: (...args) => cursos.idsDeCursosAsignados(...args),
    obtenerLeccion: (...args) => cursos.obtenerLeccion(...args),
    contarLeccionesCompletadas: (...args) => cursos.contarLeccionesCompletadas(...args),
    contarCursosCompletados: (...args) => cursos.contarCursosCompletados(...args),
    listarConCriticidad: (...args) => cursos.listarConCriticidad(...args),
    marcarCritico: (...args) => cursos.marcarCritico(...args),
    buscarVencimientosProximos: (...args) => cursos.buscarVencimientosProximos(...args)
};
