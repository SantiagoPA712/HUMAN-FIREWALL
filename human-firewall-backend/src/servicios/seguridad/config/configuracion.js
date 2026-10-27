/**
 * Configuracion del servicio de seguridad (equivale al application.yml de la
 * seccion 11 del material). Los nombres de las variables de entorno se
 * conservan para no romper ningun .env existente.
 */

const entorno = require('../../../compartido/config/entorno');
const bases = require('../../../compartido/config/bases');

/** Entero positivo del entorno; si el valor es invalido avisa y usa el defecto. */
function entero(nombre, porDefecto) {
    const crudo = process.env[nombre];
    if (crudo === undefined || crudo === '') return porDefecto;

    const valor = Number.parseInt(crudo, 10);
    if (!Number.isInteger(valor) || valor <= 0) {
        console.warn(`[seguridad] ${nombre}="${crudo}" no es un entero positivo; se usa ${porDefecto}.`);
        return porDefecto;
    }
    return valor;
}

module.exports = {
    nombre: 'seguridad',

    /**
     * Base de datos propia del servicio (el spring.datasource.url del
     * application.yml del material): SEGURIDAD_DATABASE_URL, o la de DATABASE_URL con el
     * sufijo _seguridad cuando BASES_POR_SERVICIO=true.
     */
    get baseDeDatos() { return entorno.texto('SEGURIDAD_DATABASE_URL', bases.urlPorDefecto('seguridad')); },

    /** Cada cuanto corre el job de respaldo de deteccion de anomalias. */
    get minutosEntreRevisionesDeAnomalias() { return entorno.numero('ANOMALY_JOB_INTERVAL_MINUTES', 15); },

    /** Logs: tamano de pagina por defecto del listado. */
    get tamanoDePaginaDeLogs() { return entero('LOGS_PAGE_SIZE', 50); },

    /** Logs: tope de filas de una exportacion CSV. */
    get maximoDeFilasExportadas() { return entero('LOGS_EXPORT_MAX_ROWS', 50000); },

    /** Logs: cuantos meses se conservan. */
    get mesesDeRetencion() { return entero('LOGS_RETENTION_MONTHS', 12); },

    /** Logs: cada cuanto corre la purga por retencion. */
    get horasEntrePurgas() { return entero('LOGS_RETENTION_INTERVAL_HOURS', 24); }
};
