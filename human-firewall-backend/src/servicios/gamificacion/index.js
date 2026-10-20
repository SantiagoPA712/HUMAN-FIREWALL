/**
 * Servicio de gamificacion — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 */

const manifiesto = require('./manifiesto');
const points = require('./aplicacion/points.service');
const rewards = require('./aplicacion/rewards.service');
const levels = require('./aplicacion/levels.service');
const recommendations = require('./aplicacion/recommendations.service');
const repo = require('./infraestructura/gamificacion.repositorio');

module.exports = {
    manifiesto,

    rutas: () => [{ prefijo: '/api/gamification', router: require('./api/gamification.routes') }],

    registrarHandlers() {
        points.registrarHandlers();
        rewards.registrarHandlers();
        levels.registrarHandlers();
        recommendations.registrarHandlers();
    },
    iniciarProcesos() {},
    detenerProcesos() {},

    // --- Consultas para otros servicios ---

    /** Si un movimiento con esa clave de idempotencia ya se otorgo. */
    yaOtorgado: (...args) => points.yaOtorgado(...args),
    /** Totales de puntos por usuario en un rango (reportes). */
    obtenerTotalesPorUsuarios: (...args) => points.obtenerTotalesPorUsuarios(...args),
    /** Resumen de recompensas por usuario en un rango (reportes). */
    obtenerResumenPorUsuarios: (...args) => rewards.obtenerResumenPorUsuarios(...args),
    /** Escalera de niveles y calculo del progreso dentro de un nivel. */
    obtenerEscalera: (...args) => levels.obtenerEscalera(...args),
    calcularProgreso: (...args) => levels.calcularProgreso(...args),
    /** Total de puntos y nivel actual de un usuario (seguridad, al auditar un ajuste). */
    obtenerPuntos: (...args) => levels.obtenerPuntos(...args),
    obtenerNivelDeUsuario: (...args) => levels.obtenerNivelDeUsuario(...args),
    contarRecompensasDe: (...args) => repo.contarRecompensasDe(...args),
    buscarRecompensa: (...args) => repo.buscarRecompensa(...args),

    // --- Comandos para otros servicios (ajustes manuales auditados por seguridad) ---

    /** Inserta un movimiento en el historial de puntos (idempotente por clave). */
    registrarMovimiento: (...args) => points.registrarMovimiento(...args),
    /** Otorga una recompensa con snapshot y sin duplicados. */
    otorgarRecompensa: (...args) => rewards.otorgarRecompensa(...args)
};
