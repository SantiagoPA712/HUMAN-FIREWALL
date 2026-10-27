/**
 * Configuracion del servicio de gamificacion (equivale al application.yml de
 * la seccion 11 del material).
 *
 * Este servicio no lee variables de entorno propias: las reglas de puntos,
 * niveles y recompensas son DATOS (points_rules, levels_config,
 * rewards_catalog) que el admin edita desde la aplicacion, no configuracion
 * de despliegue. Aca quedan los parametros tecnicos del servicio.
 */

const entorno = require('../../../compartido/config/entorno');
const bases = require('../../../compartido/config/bases');

module.exports = {
    nombre: 'gamificacion',

    /**
     * Base de datos propia del servicio (el spring.datasource.url del
     * application.yml del material): GAMIFICACION_DATABASE_URL, o la de DATABASE_URL con el
     * sufijo _gamificacion cuando BASES_POR_SERVICIO=true.
     */
    get baseDeDatos() { return entorno.texto('GAMIFICACION_DATABASE_URL', bases.urlPorDefecto('gamificacion')); },

    /** Cuantos resultados recientes se miran para calcular una racha. */
    resultadosParaRacha: 100
};
