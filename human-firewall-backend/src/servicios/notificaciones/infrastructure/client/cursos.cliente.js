/** Cliente del servicio de cursos, visto desde notificaciones. */
const cursos = () => require('../../../cursos/index');

module.exports = {
    /** { id, title, is_critical } o null. */
    obtenerTitulo: (courseId) => cursos().obtenerTitulo(courseId),
    listarConCriticidad: () => cursos().listarConCriticidad(),
    marcarCritico: (courseId, critico) => cursos().marcarCritico(courseId, critico)
};
