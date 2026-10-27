/**
 * Cliente del servicio de cursos, visto desde reportes.
 * Ver servicios/evaluaciones/infrastructure/client/cursos.cliente.js.
 */
const cursos = () => require('../../../cursos/index');

module.exports = {
    /** { id, title, is_critical } de un curso, o null. */
    obtenerTitulo: (id) => cursos().obtenerTitulo(id),
    obtenerTitulos: (ids) => cursos().obtenerTitulos(ids),
    /** Todos los cursos { id, title } por titulo. */
    titulosOrdenados: () => cursos().titulosOrdenados(),
    /** Ids de los usuarios con ese curso asignado. */
    usuariosAsignadosA: (courseId) => cursos().usuariosAsignadosA(courseId),
    /** Asignaciones { user_id, course_id, status } de esos usuarios. */
    asignacionesDe: (userIds) => cursos().asignacionesDe(userIds),
    /** [{ user_id, acciones }]: lecciones completadas en [desde, hasta). */
    accionesPorUsuarioEntre: (desde, hasta) => cursos().accionesPorUsuarioEntre(desde, hasta),
    /** [{ user_id, ultima }]: ultima leccion completada. */
    ultimaActividadDe: (userIds) => cursos().ultimaActividadDe(userIds),
    /** [{ user_id, cursos }]: cursos completados en [desde, hasta). */
    cursosCompletadosPorUsuarioEntre: (desde, hasta) => cursos().cursosCompletadosPorUsuarioEntre(desde, hasta)
};
