/**
 * Controlador de Dashboard Centralizado.
 *
 * Expone endpoints para consulta y personalizacion de widgets de dashboard.
 */

const dashboardService = require('../services/dashboard.service');

/**
 * GET /api/gamification/dashboard
 * Retorna la composicion de widgets disponibles y autorizados para el usuario.
 */
exports.getDashboard = async (req, res) => {
    try {
        const dashboard = await dashboardService.getDashboardForUser({
            userId: req.user.id,
            role: req.user.role
        });

        return res.status(200).json(dashboard);
    } catch (error) {
        console.error('[dashboardController.getDashboard] Error:', error.message);
        return res.status(500).json({ msg: "Error al construir el dashboard", error: error.message });
    }
};

/**
 * GET /api/gamification/dashboard/widgets/:widgetId
 * Retorna los datos de un widget individual.
 * Si el widget no corresponde al rol o no existe, retorna 403 con mensaje generico.
 */
exports.getWidget = async (req, res) => {
    try {
        const { widgetId } = req.params;
        const widget = await dashboardService.getWidgetDataForUser({
            userId: req.user.id,
            role: req.user.role,
            widgetId
        });

        return res.status(200).json(widget);
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            msg: error.message || "Acceso denegado o recurso no disponible"
        });
    }
};

/**
 * PUT /api/gamification/dashboard/config
 * Guarda la configuracion personalizada de widgets del usuario.
 */
exports.saveConfig = async (req, res) => {
    try {
        const { widgets } = req.body;
        if (!widgets) {
            return res.status(400).json({ msg: "El campo 'widgets' es obligatorio" });
        }

        const config = await dashboardService.saveUserDashboardConfig({
            userId: req.user.id,
            role: req.user.role,
            widgets
        });

        return res.status(200).json({
            msg: "Configuracion de dashboard guardada exitosamente",
            config
        });
    } catch (error) {
        const status = error.status || 400;
        return res.status(status).json({ msg: error.message });
    }
};
