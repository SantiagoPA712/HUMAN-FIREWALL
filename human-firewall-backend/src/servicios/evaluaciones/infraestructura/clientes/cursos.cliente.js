/**
 * Cliente del servicio de cursos, visto desde evaluaciones.
 *
 * Capa de infraestructura / integracion. Es el UNICO archivo de
 * evaluaciones que conoce al servicio de cursos, y solo a traves de su
 * puerta publica (servicios/cursos/index.js).
 *
 * Hoy la llamada es en proceso. Si cursos se extrajera a otro despliegue,
 * este archivo pasaria a hacer la llamada HTTP (con timeout y reintentos) y
 * el resto de evaluaciones no se enteraria.
 *
 * El require es diferido (dentro de la funcion) para no crear ciclos de
 * carga entre servicios que se usan mutuamente.
 */
const cursos = () => require('../../../cursos');

module.exports = {
    /** Ids de los cursos asignados al usuario. */
    idsDeCursosAsignados: (userId) => cursos().idsDeCursosAsignados(userId),
    /** [{ id, title }] de los cursos pedidos. */
    obtenerTitulos: (ids) => cursos().obtenerTitulos(ids)
};
