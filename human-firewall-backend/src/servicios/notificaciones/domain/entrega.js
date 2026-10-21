/**
 * Entrega de correos (servicio de notificaciones).
 *
 * Capa Domain (seccion 11 del material): Regla de reintentos: que errores de envio son transitorios y vale la pena reintentar.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

/**
 * Un error es transitorio si reintentar puede servir.
 *
 * El criterio tecnico 3 nombra dos casos: timeout y "error 5xx del
 * proveedor". Ademas se reintentan los codigos SMTP de la familia 4xx que
 * significan "intentalo mas tarde" (421 servicio no disponible, 45x buzon
 * ocupado o sin espacio temporal). Todo lo demas -- destinatario rechazado,
 * credenciales invalidas, mensaje mal formado -- va a fallar igual la
 * proxima vez, y reintentarlo solo demora el diagnostico.
 */
const CODIGOS_DE_RED = new Set([
    'ETIMEDOUT', 'ETIMEOUT', 'ECONNECTION', 'ESOCKET',
    'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EDNS'
]);

function esErrorTransitorio(err) {
    if (!err) return false;
    if (CODIGOS_DE_RED.has(err.code)) return true;

    const estado = Number(err.responseCode ?? err.statusCode ?? err.status);
    if (estado >= 500 && estado <= 599) return true;
    return [421, 450, 451, 452].includes(estado);
}

module.exports = { CODIGOS_DE_RED, esErrorTransitorio };
