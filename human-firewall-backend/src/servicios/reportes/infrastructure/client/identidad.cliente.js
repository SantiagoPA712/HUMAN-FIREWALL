/**
 * Cliente del servicio de identidad, visto desde reportes.
 *
 * Las cuentas y los equipos viven en la base de identidad: reportes los pide
 * por su contrato y agrega en memoria (base de datos por servicio).
 */
const identidad = () => require('../../../identidad/index');

module.exports = {
    /** Cuentas activas { id, email, role, team_id, equipo, created_at, total_points }. */
    usuariosActivos: () => identidad().usuariosActivos(),
    /** Ids de las cuentas activas con alguno de esos roles. */
    activosConRoles: (roles) => identidad().activosConRoles(roles),
    /** { id, name, is_active } o null. */
    buscarEquipo: (id) => identidad().buscarEquipo(id),
    /** Equipos activos { id, name } por nombre. */
    equiposActivos: () => identidad().equiposActivos()
};
