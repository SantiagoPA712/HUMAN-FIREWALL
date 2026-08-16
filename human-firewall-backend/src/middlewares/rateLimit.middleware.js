const rateLimit = require('express-rate-limit');

exports.loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { msg: "Demasiados intentos de inicio de sesión, por favor intente nuevamente más tarde." }
});
