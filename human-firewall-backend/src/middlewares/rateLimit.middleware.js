const rateLimit = require('express-rate-limit');

exports.loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { msg: "Demasiados intentos de inicio de sesión, por favor intente nuevamente más tarde." }
});

exports.dashboardLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 120,
    message: { msg: "Límite de solicitudes al dashboard excedido, por favor espere." }
});
