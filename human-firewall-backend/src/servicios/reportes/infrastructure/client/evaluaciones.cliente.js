/**
 * Cliente del servicio de evaluaciones, visto desde reportes.
 * Ver servicios/evaluaciones/infrastructure/client/cursos.cliente.js.
 */
const evaluaciones = () => require('../../../evaluaciones/index');

module.exports = {
    /** [{ user_id, acciones }]: intentos de evaluacion en [desde, hasta). */
    accionesPorUsuarioEntre: (desde, hasta) => evaluaciones().accionesPorUsuarioEntre(desde, hasta),
    /** [{ user_id, ultima }]: ultimo intento. */
    ultimaActividadDe: (userIds) => evaluaciones().ultimaActividadDe(userIds)
};
