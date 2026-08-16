const jwt = require('jsonwebtoken');

exports.verifyToken = (roles = []) => {
    return (req, res, next) => {
        try {
            // Verificar si hay header de autorización
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ msg: "Acceso denegado: Token no proporcionado" });
            }

            // Extraer token
            const token = authHeader.split(' ')[1];
            
            // Verificar token
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            req.user = decoded;

            // Verificar roles si se especificaron
            if (roles.length > 0 && !roles.includes(decoded.role)) {
                return res.status(403).json({ msg: "Acceso denegado: Permisos insuficientes" });
            }

            next();
        } catch (error) {
            return res.status(401).json({ msg: "Token inválido o expirado" });
        }
    };
};
