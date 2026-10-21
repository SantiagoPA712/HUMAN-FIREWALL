/**
 * Servicio de seguridad — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 */

const manifiesto = require('./manifiesto');
const dataLogs = require('./application/dataLogs.service');
const anomalies = require('./application/anomalies.service');
const audit = require('./application/audit.service');

module.exports = {
    manifiesto,

    /** Contrato publico (OpenAPI) de la API HTTP del servicio. */
    contrato: () => require('./contract/openapi'),

    rutas: () => [
        { prefijo: '/api/gamification/security', router: require('./controller/seguridad.routes') },
        { prefijo: '/api/gamification/users', router: require('./controller/ajustes.routes') },
        { prefijo: '/api/logs', router: require('./controller/logs.routes') }
    ],

    registrarHandlers() {
        anomalies.registrarHandlers();
        dataLogs.registrarHandlers();
    },

    /**
     * Job de respaldo de la deteccion de anomalias y politica de retencion
     * de data.logs. Son relojes, no suscripciones.
     */
    iniciarProcesos() {
        anomalies.iniciarJob();
        dataLogs.iniciarJobRetencion();
    },
    detenerProcesos() {
        anomalies.detenerJob();
        dataLogs.detenerJobRetencion();
    },

    // --- Comandos para otros servicios ---

    /**
     * Registra una accion critica en data.logs. Publica audit.log_recorded y
     * vuelve: el log se escribe fuera del request y nunca hace fallar la
     * accion original. Valores sensibles salen enmascarados.
     */
    registrarAccion: (datos) => dataLogs.registrar(datos),
    ACCIONES: dataLogs.ACCIONES,
    MODULOS: dataLogs.MODULOS,

    /** Deja constancia de un ajuste manual en audit_log (panel de seguridad). */
    auditarAjusteManual: (datos, client) => audit.registrar(datos, client)
};
