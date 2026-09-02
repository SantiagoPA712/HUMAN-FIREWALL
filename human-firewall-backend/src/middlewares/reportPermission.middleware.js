/**
 * Middleware de Control de Acceso a Reportes y Recursos (RBAC Dinamico).
 *
 * Equivalente al HandlerInterceptor / OncePerRequestFilter de Spring:
 * 1. Extrae el claim 'role' e 'id' del JWT decodificado en req.user.
 * 2. Consulta report_permissions (apoyado en cache en memoria) para verificar si el rol tiene permitido
 *    ejecutar la accion (view/export/modify) sobre el recurso (performance/anomalies/organizational/dashboard).
 * 3. Si no esta permitido: registra SINCRONICAMENTE en permission_audit_log (result='denied')
 *    y responde HTTP 403 Forbidden ANTES de llegar al controlador.
 * 4. Si esta permitido: opcionalmente registra auditoria (result='allowed') y continua la cadena de middlewares.
 */

const permissionService = require('../services/permission.service');

/**
 * Deduce la accion a partir del metodo HTTP y la ruta si no se especifica explicitamente.
 */
function inferAction(req) {
    const url = (req.originalUrl || req.url || '').toLowerCase();
    const method = (req.method || 'GET').toUpperCase();

    if (url.includes('/export') || url.includes('/download')) {
        return 'export';
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return 'modify';
    }
    return 'view';
}

/**
 * Factory middleware para proteger endpoints segun recurso y accion.
 *
 * @param {string} resource - 'performance' | 'anomalies' | 'organizational' | 'dashboard'
 * @param {string} [actionOverride] - 'view' | 'export' | 'modify' (opcional, se deduce del request si no se pasa)
 * @param {object} [options]
 * @param {boolean} [options.logAllowed=false] - Si se deben auditar tambien los accesos permitidos
 */
function requireReportPermission(resource, actionOverride = null, { logAllowed = false } = {}) {
    return async (req, res, next) => {
        try {
            // El usuario debe estar previamente autenticado (verifyToken)
            if (!req.user) {
                return res.status(401).json({ msg: "Acceso denegado: Token de autenticacion requerido" });
            }

            const role = req.user.role || 'employee';
            const userId = req.user.id;
            const action = actionOverride || inferAction(req);

            // Verificacion de permiso contra cache / base de datos
            const allowed = await permissionService.hasPermission(role, resource, action);

            if (!allowed) {
                // Registro SINCRONICO en auditoria de intento denegado
                await permissionService.logPermissionAudit({
                    userId,
                    resource,
                    action,
                    result: 'denied'
                });

                return res.status(403).json({
                    msg: `Acceso denegado: El rol '${role}' no tiene permiso para la accion '${action}' sobre el recurso '${resource}'`
                });
            }

            // Registro opcional de accesos permitidos
            if (logAllowed) {
                await permissionService.logPermissionAudit({
                    userId,
                    resource,
                    action,
                    result: 'allowed'
                });
            }

            next();
        } catch (error) {
            console.error('[requireReportPermission] Error verificando permisos:', error.message);
            return res.status(500).json({ msg: "Error interno al verificar permisos de reporte", error: error.message });
        }
    };
}

module.exports = {
    requireReportPermission,
    inferAction
};
