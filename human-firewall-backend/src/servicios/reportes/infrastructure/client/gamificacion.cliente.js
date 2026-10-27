/**
 * Cliente del servicio de gamificacion, visto desde reportes.
 *
 * Reportes no recalcula puntos, niveles ni recompensas: se los pide a
 * gamificacion por este contrato. Si manana cambian las reglas de puntuacion
 * o los umbrales de nivel, reportes no se toca.
 */
const gamificacion = () => require('../../../gamificacion/index');

module.exports = {
    obtenerTotalesPorUsuarios: (ids, rango) => gamificacion().obtenerTotalesPorUsuarios(ids, rango),
    obtenerResumenPorUsuarios: (ids, rango) => gamificacion().obtenerResumenPorUsuarios(ids, rango),
    obtenerEscalera: () => gamificacion().obtenerEscalera(),
    calcularProgreso: (puntos, escalera) => gamificacion().calcularProgreso(puntos, escalera),
    /** [{ user_id, acciones }]: movimientos de puntos en [desde, hasta). */
    accionesPorUsuarioEntre: (desde, hasta) => gamificacion().accionesPorUsuarioEntre(desde, hasta),
    /** [{ user_id, ultima }]: ultimo movimiento. */
    ultimaActividadDe: (userIds) => gamificacion().ultimaActividadDe(userIds),
    /** [{ user_id, puntos }]: puntos acumulados antes de `fin`. */
    puntosPorUsuarioHasta: (fin) => gamificacion().puntosPorUsuarioHasta(fin)
};
