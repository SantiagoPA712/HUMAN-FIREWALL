/**
 * Configuracion del servicio de gamificacion (equivale al application.yml de
 * la seccion 11 del material).
 *
 * Este servicio no lee variables de entorno propias: las reglas de puntos,
 * niveles y recompensas son DATOS (points_rules, levels_config,
 * rewards_catalog) que el admin edita desde la aplicacion, no configuracion
 * de despliegue. Aca quedan los parametros tecnicos del servicio.
 */

module.exports = {
    nombre: 'gamificacion',

    /** Cuantos resultados recientes se miran para calcular una racha. */
    resultadosParaRacha: 100
};
