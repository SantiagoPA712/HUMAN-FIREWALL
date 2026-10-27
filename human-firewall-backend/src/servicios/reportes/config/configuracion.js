/**
 * Configuracion del servicio de reportes (equivale al application.yml de la
 * seccion 11 del material). Los nombres de las variables de entorno se
 * conservan para no romper ningun .env existente.
 */

const entorno = require('../../../compartido/config/entorno');
const bases = require('../../../compartido/config/bases');

module.exports = {
    nombre: 'reportes',

    /**
     * Base de datos propia del servicio (el spring.datasource.url del
     * application.yml del material): REPORTES_DATABASE_URL, o la de DATABASE_URL con el
     * sufijo _reportes cuando BASES_POR_SERVICIO=true.
     */
    get baseDeDatos() { return entorno.texto('REPORTES_DATABASE_URL', bases.urlPorDefecto('reportes')); },

    /** Hasta cuantas filas una exportacion se genera en el mismo request. */
    get limiteDeExportacionSincrona() { return entorno.numero('REPORT_EXPORT_SYNC_LIMIT', 5000); },

    /** Cada cuanto se toma el snapshot de KPIs organizacionales. */
    get horasEntreSnapshotsDeKpis() { return entorno.numero('ORG_KPI_JOB_INTERVAL_HOURS', 24); },

    /** Cada cuanto revisa el scheduler si vencio alguna programacion. */
    get segundosEntreRevisionesDelScheduler() { return entorno.numero('REPORT_SCHEDULER_INTERVAL_SECONDS', 60); },

    /** Base del backoff de los avisos de reportes programados. */
    get segundosBaseDeReintentoDeAvisos() { return entorno.numero('REPORT_NOTIFY_BACKOFF_SECONDS', 60); },

    /** Roles a los que se avisa cuando falla una generacion. */
    get rolesTecnicos() {
        return entorno.texto('REPORT_TECH_ROLES', 'admin').split(',').map(r => r.trim()).filter(Boolean);
    }
};
