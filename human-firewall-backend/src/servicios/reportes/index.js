/**
 * Servicio de reportes — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 *
 * Nadie consume reportes desde otro servicio: su contrato publico es solo
 * HTTP. Por eso este index no expone funciones.
 */

const manifiesto = require('./manifiesto');
const reportExports = require('./application/reportExports.service');
const scheduledReports = require('./application/scheduledReports.service');
const orgReports = require('./application/orgReports.service');

module.exports = {
    manifiesto,

    /** Contrato publico (OpenAPI) de la API HTTP del servicio. */
    contrato: () => require('./contract/openapi'),

    rutas: () => [{ prefijo: '/api/gamification/reports', router: require('./controller/reportes.routes') }],

    registrarHandlers() {
        reportExports.registrarHandlers();
        scheduledReports.registrarHandlers();
        orgReports.registrarHandlers();
    },

    /**
     * scheduler -> mira que programacion vencio y encola su generacion.
     * job de KPIs -> recalcula los snapshots organizacionales.
     * Ninguno hace el trabajo: encolan, y el bus ejecuta.
     */
    iniciarProcesos() {
        scheduledReports.iniciarScheduler();
        orgReports.iniciarJob();
    },
    detenerProcesos() {
        scheduledReports.detenerScheduler();
        orgReports.detenerJob();
    }
};
