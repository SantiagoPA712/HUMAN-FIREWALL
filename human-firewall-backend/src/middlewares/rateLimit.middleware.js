const rateLimit = require('express-rate-limit');

exports.loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { msg: "Demasiados intentos de inicio de sesión, por favor intente nuevamente más tarde." }
});

/**
 * Rutas publicas de invitaciones (validar, aceptar, pedir reenvio). No
 * requieren sesion, asi que el limite es lo que impide probar tokens en
 * rafaga. Holgado para un humano que se equivoca de contrasena un par de
 * veces; corto para un script.
 */
exports.invitationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { msg: "Demasiados intentos con enlaces de invitacion, por favor intente nuevamente mas tarde." }
});
