/**
 * Cliente del servicio de identidad, visto desde notificaciones.
 * Ver servicios/evaluaciones/infraestructura/clientes/cursos.cliente.js.
 */
const identidad = () => require('../../../identidad/index');

module.exports = {
    correoDe: (userId) => identidad().correoDe(userId),
    /** { id, email, language, full_name } o null. */
    obtenerContacto: (userId) => identidad().obtenerContacto(userId),
    /** Ids de RH a avisar por un empleado. */
    responsablesRhDe: (userId) => identidad().responsablesRhDe(userId)
};
