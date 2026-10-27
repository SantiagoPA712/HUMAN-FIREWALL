/**
 * Cliente del servicio de cursos, visto desde gamificacion.
 * Ver servicios/evaluaciones/infrastructure/client/cursos.cliente.js.
 */
const cursos = () => require('../../../cursos/index');

module.exports = {
    /** { id, course_id, points_reward } de la leccion, o null si no existe. */
    obtenerLeccion: (contentId) => cursos().obtenerLeccion(contentId),
    contarLeccionesCompletadas: (userId) => cursos().contarLeccionesCompletadas(userId),
    contarCursosCompletados: (userId) => cursos().contarCursosCompletados(userId),
    /** Recomendaciones: titulos, cursos asignados, avance y lecciones pendientes. */
    obtenerTitulos: (ids) => cursos().obtenerTitulos(ids),
    idsDeCursosAsignados: (userId) => cursos().idsDeCursosAsignados(userId),
    avanceDe: (userId) => cursos().avanceDe(userId),
    leccionesPendientes: (courseIds, userId) => cursos().leccionesPendientes(courseIds, userId)
};
