/**
 * Cliente del servicio de gamificacion, visto desde seguridad.
 *
 * Seguridad audita los ajustes manuales de puntos, niveles e insignias, pero
 * no es duena de esos datos: los ajustes se aplican por este contrato.
 * Ver servicios/evaluaciones/infrastructure/client/cursos.cliente.js.
 */
const gamificacion = () => require('../../../gamificacion/index');

module.exports = {
    obtenerPuntos: (userId) => gamificacion().obtenerPuntos(userId),
    obtenerNivelDeUsuario: (userId) => gamificacion().obtenerNivelDeUsuario(userId),
    contarRecompensasDe: (userId) => gamificacion().contarRecompensasDe(userId),
    obtenerEscalera: () => gamificacion().obtenerEscalera(),
    buscarRecompensa: (id) => gamificacion().buscarRecompensa(id),
    registrarMovimiento: (datos) => gamificacion().registrarMovimiento(datos),
    otorgarRecompensa: (datos) => gamificacion().otorgarRecompensa(datos),
    /** Historial de puntos para detectar anomalias (base de datos por servicio). */
    movimientosEnVentana: (userId, ventanaMinutos, hasta) => gamificacion().movimientosEnVentana(userId, ventanaMinutos, hasta),
    usuariosConMovimientosRecientes: (minutos) => gamificacion().usuariosConMovimientosRecientes(minutos),
    ultimosMovimientos: (userId, limite) => gamificacion().ultimosMovimientos(userId, limite)
};
