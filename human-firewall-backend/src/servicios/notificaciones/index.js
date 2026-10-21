/**
 * Servicio de notificaciones — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 */

const manifiesto = require('./manifiesto');
const notifications = require('./application/notifications.service');
const resultNotifications = require('./application/resultNotifications.service');
const emailNotifications = require('./application/emailNotifications.service');

module.exports = {
    manifiesto,

    /** Contrato publico (OpenAPI) de la API HTTP del servicio. */
    contrato: () => require('./contract/openapi'),

    rutas: () => [{ prefijo: '/api/notifications', router: require('./controller/notification.routes') }],

    registrarHandlers() {
        notifications.registrarHandlers();
        resultNotifications.registrarHandlers();
        emailNotifications.registrarHandlers();
    },
    /** Worker de la cola de correo (email_jobs), con sus propios reintentos. */
    iniciarProcesos() { emailNotifications.iniciarWorker(); },
    detenerProcesos() { emailNotifications.detenerWorker(); },

    // --- Comandos para otros servicios ---

    /** Deja un aviso en la bandeja in-app sin mandar correo. Idempotente por dedupeKey. */
    avisarEnBandeja: (...args) => notifications.crearSinEnviar(...args),
    /** Deja un aviso en la bandeja y, si hay SMTP, lo manda por correo. */
    notificar: (...args) => notifications.notificar(...args),
    /** Reintenta el correo de un aviso ya creado. */
    reenviarCorreo: (...args) => notifications.reenviarCorreo(...args)
};
