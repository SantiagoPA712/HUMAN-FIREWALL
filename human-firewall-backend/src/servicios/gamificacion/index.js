/**
 * Servicio de gamificacion — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 */

const manifiesto = require('./manifiesto');
const points = require('./application/points.service');
const rewards = require('./application/rewards.service');
const levels = require('./application/levels.service');
const recommendations = require('./application/recommendations.service');
const repo = require('./infrastructure/persistence/gamificacion.repositorio');
const puntos = require('./infrastructure/persistence/puntos.repositorio');

module.exports = {
    manifiesto,

    /** Contrato publico (OpenAPI) de la API HTTP del servicio. */
    contrato: () => require('./contract/openapi'),

    rutas: () => [{ prefijo: '/api/gamification', router: require('./controller/gamification.routes') }],

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

    // Consultas de lectura sobre el historial de puntos para reportes y
    // seguridad (base de datos por servicio: nadie mas lee points_ledger).
    accionesPorUsuarioEntre: (...args) => puntos.movimientosPorUsuarioEntre(...args),
    ultimaActividadDe: (...args) => puntos.ultimoMovimientoDe(...args),
    puntosPorUsuarioHasta: (...args) => puntos.puntosPorUsuarioHasta(...args),
    movimientosEnVentana: (...args) => puntos.movimientosEnVentana(...args),
    usuariosConMovimientosRecientes: (...args) => puntos.usuariosConMovimientosRecientes(...args),
    ultimosMovimientos: (...args) => puntos.ultimosMovimientos(...args),

    // --- Comandos para otros servicios (ajustes manuales auditados por seguridad) ---

    /** Inserta un movimiento en el historial de puntos (idempotente por clave). */
    registrarMovimiento: (...args) => points.registrarMovimiento(...args),
    /** Otorga una recompensa con snapshot y sin duplicados. */
    otorgarRecompensa: (...args) => rewards.otorgarRecompensa(...args)
};
