/**
 * Configuracion del servicio de cursos (equivale al application.yml de la
 * seccion 11). Los nombres de las variables de entorno se conservan para no
 * romper ningun .env existente.
 */

const entorno = require('../../../compartido/config/entorno');
const bases = require('../../../compartido/config/bases');

module.exports = {
    nombre: 'cursos',

    /**
     * Base de datos propia del servicio (el spring.datasource.url del
     * application.yml del material): CURSOS_DATABASE_URL, o la de DATABASE_URL con el
     * sufijo _cursos cuando BASES_POR_SERVICIO=true.
     */
    get baseDeDatos() { return entorno.texto('CURSOS_DATABASE_URL', bases.urlPorDefecto('cursos')); },

    /** Con cuanta anticipacion se avisa que vence un curso asignado. */
    get horasDeVentanaVencimiento() { return entorno.numero('EMAIL_DEADLINE_WINDOW_HOURS', 48); },

    /** Cada cuanto se buscan fechas limite proximas. */
    get minutosEntreBusquedasDeVencimiento() { return entorno.numero('EMAIL_DEADLINE_SCAN_MINUTES', 15); },

    /** Puntos por defecto de una leccion nueva si no se indican. */
    puntosPorDefectoDeLeccion: 10
};
