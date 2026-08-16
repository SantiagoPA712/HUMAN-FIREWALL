/**
 * Middlewares de autorizacion por rol.
 *
 * Este archivo existia vacio en el proyecto. verifyToken solo sabe validar
 * contra una lista blanca de roles, pero varios endpoints necesitan la regla
 * "el propio usuario, o alguien con rol suficiente", que es distinta.
 *
 * Se usa siempre DESPUES de verifyToken, que es quien llena req.user.
 */

/**
 * Permite el acceso si el usuario autenticado es el dueno del recurso, o si
 * tiene alguno de los roles indicados.
 *
 * Criterio tecnico 3 de la HU de puntos: el endpoint debe respetar las mismas
 * restricciones de rol que el historial de desempeno (propio usuario, admin o rh).
 *
 * @param {string[]} roles       roles que pueden ver el recurso de cualquier usuario
 * @param {string}   paramName   nombre del parametro de ruta con el id del dueno
 */
exports.selfOrRoles = (roles = ['admin', 'rh'], paramName = 'userId') => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ msg: "No autenticado" });
        }

        const idSolicitado = Number.parseInt(req.params[paramName], 10);
        if (!Number.isInteger(idSolicitado) || idSolicitado <= 0) {
            return res.status(400).json({ msg: `Parametro ${paramName} invalido` });
        }

        // El propio usuario siempre puede ver lo suyo.
        if (Number(req.user.id) === idSolicitado) return next();

        // Roles con permiso para consultar a terceros.
        if (roles.includes(req.user.role)) return next();

        return res.status(403).json({
            msg: "Acceso denegado: solo el propio usuario, admin o rh pueden consultar este recurso"
        });
    };
};

/**
 * Restringe el acceso a una lista de roles, sin la excepcion del dueno.
 * Equivale a verifyToken(roles), pero se puede componer despues de otros
 * middlewares.
 */
exports.requireRoles = (roles = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ msg: "No autenticado" });
        }
        if (roles.length > 0 && !roles.includes(req.user.role)) {
            return res.status(403).json({ msg: "Acceso denegado: permisos insuficientes" });
        }
        next();
    };
};
