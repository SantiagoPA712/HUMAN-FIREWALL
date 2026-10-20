/**
 * Cliente del servicio de gamificacion, visto desde seguridad.
 *
 * Seguridad audita los ajustes manuales de puntos, niveles e insignias, pero
 * no es duena de esos datos: los ajustes se aplican por este contrato.
 * Ver servicios/evaluaciones/infraestructura/clientes/cursos.cliente.js.
 */
const gamificacion = () => require('../../../gamificacion');

module.exports = {
    obtenerPuntos: (userId) => gamificacion().obtenerPuntos(userId),
    obtenerNivelDeUsuario: (userId) => gamificacion().obtenerNivelDeUsuario(userId),
    contarRecompensasDe: (userId) => gamificacion().contarRecompensasDe(userId),
    obtenerEscalera: () => gamificacion().obtenerEscalera(),
    buscarRecompensa: (id) => gamificacion().buscarRecompensa(id),
    registrarMovimiento: (datos) => gamificacion().registrarMovimiento(datos),
    otorgarRecompensa: (datos) => gamificacion().otorgarRecompensa(datos)
};
