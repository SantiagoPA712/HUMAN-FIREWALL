/**
 * Controlador de Permisos de Reportes y Auditoria.
 *
 * Expone endpoints REST para administracion de permisos e historial con autorizacion estricta.
 */

const permissionService = require('../services/permission.service');

/**
 * GET /api/gamification/permissions
 * Lista los permisos configurados.
 */
exports.listPermissions = async (req, res) => {
    try {
        const { role, resource } = req.query;
        const permissions = await permissionService.listPermissions({ role, resource });
        return res.status(200).json({ permissions });
    } catch (error) {
        return res.status(500).json({ msg: "Error al consultar permisos", error: error.message });
    }
};

/**
 * POST /api/gamification/permissions
 * Crea o asigna un permiso para un rol.
 */
exports.createPermission = async (req, res) => {
    try {
        const { role, resource, action, allowed = true } = req.body;
        if (!role || !resource || !action) {
            return res.status(400).json({ msg: "Los campos 'role', 'resource' y 'action' son obligatorios" });
        }

        const permission = await permissionService.savePermission({
            role,
            resource,
            action,
            allowed,
            changedBy: req.user.id
        });

        return res.status(201).json({
            msg: "Permiso configurado exitosamente",
            permission
        });
    } catch (error) {
        return res.status(400).json({ msg: error.message });
    }
};

/**
 * PATCH /api/gamification/permissions
 * Modifica un permiso existente.
 */
exports.updatePermission = async (req, res) => {
    try {
        const { role, resource, action, allowed } = req.body;
        if (!role || !resource || !action || allowed === undefined) {
            return res.status(400).json({ msg: "Los campos 'role', 'resource', 'action' y 'allowed' son obligatorios" });
        }

        const permission = await permissionService.savePermission({
            role,
            resource,
            action,
            allowed,
            changedBy: req.user.id
        });

        return res.status(200).json({
            msg: "Permiso actualizado exitosamente",
            permission
        });
    } catch (error) {
        return res.status(400).json({ msg: error.message });
    }
};

/**
 * DELETE /api/gamification/permissions
 * Elimina un permiso configurado.
 */
exports.deletePermission = async (req, res) => {
    try {
        const role = req.body.role || req.query.role;
        const resource = req.body.resource || req.query.resource;
        const action = req.body.action || req.query.action;

        if (!role || !resource || !action) {
            return res.status(400).json({ msg: "Los parametros 'role', 'resource' y 'action' son obligatorios" });
        }

        const deleted = await permissionService.deletePermission({
            role,
            resource,
            action,
            changedBy: req.user.id
        });

        if (!deleted) {
            return res.status(404).json({ msg: "Permiso no encontrado" });
        }

        return res.status(200).json({
            msg: "Permiso eliminado exitosamente",
            deleted
        });
    } catch (error) {
        return res.status(400).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/permissions/history
 * Obtiene el historial de modificaciones paginado y ordenado por timestamp descendente.
 */
exports.getPermissionHistory = async (req, res) => {
    try {
        const { page = 1, limit = 20, resource } = req.query;
        const history = await permissionService.getPermissionHistory({
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            resource
        });

        return res.status(200).json(history);
    } catch (error) {
        return res.status(500).json({ msg: "Error al obtener historial de permisos", error: error.message });
    }
};
