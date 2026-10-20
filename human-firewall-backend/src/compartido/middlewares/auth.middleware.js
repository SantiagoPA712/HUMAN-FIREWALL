/**
 * Autenticacion por JWT (verifyToken) con verificacion opcional de rol.
 */

const jwt = require('jsonwebtoken');
const { secretoJwt } = require('../config/entorno');
const { CODIGOS, responderError } = require('../http/errores');

/**
 * Verifica el JWT del encabezado Authorization y, si se piden roles, que el
 * claim role este entre ellos. Llena req.user con { id, role }.
 *
 *   401 sin token, con token invalido o vencido
 *   403 con token valido pero rol insuficiente
 *
 * Ninguna de las dos verificaciones consulta la base: el rol viaja en el
 * token. Por eso los 401/403 salen sin ejecutar ninguna consulta.
 *
 * Antes, si faltaba JWT_SECRET, se verificaba contra la cadena 'secret': con
 * ese valor cualquiera podia fabricarse un token de admin. Ahora no hay valor
 * por defecto (ver compartido/config/entorno.js).
 *
 * @param {string[]} roles  roles permitidos; vacio = cualquier usuario autenticado
 */
exports.verifyToken = (roles = []) => {
    const middleware = function verificarToken(req, res, next) {
        let secreto;
        try {
            secreto = secretoJwt();
        } catch (error) {
            return responderError(req, res, error);
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: "Acceso denegado: Token no proporcionado", codigo: CODIGOS.NO_AUTENTICADO });
        }

        let decoded;
        try {
            decoded = jwt.verify(authHeader.split(' ')[1], secreto);
        } catch (error) {
            return res.status(401).json({ msg: "Token inválido o expirado", codigo: CODIGOS.NO_AUTENTICADO });
        }
        req.user = decoded;

        if (roles.length > 0 && !roles.includes(decoded.role)) {
            return res.status(403).json({ msg: "Acceso denegado: Permisos insuficientes", codigo: CODIGOS.PROHIBIDO });
        }

        next();
    };

    // Las pruebas de contrato leen estas marcas para comprobar que lo que
    // documenta el contrato (autenticacion y roles) es lo que aplica la ruta.
    middleware.requiereAutenticacion = true;
    middleware.roles = roles;
    return middleware;
};
