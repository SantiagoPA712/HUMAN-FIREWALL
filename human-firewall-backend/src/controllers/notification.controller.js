const notificationsService = require('../services/notifications.service');
const eventBus = require('../services/eventBus');

/**
 * GET /api/notifications
 *
 * Bandeja del usuario autenticado. No recibe userId por parametro a
 * proposito: una notificacion es del dueno y de nadie mas, ni siquiera de un
 * admin, asi que el id sale del token y no de la URL. Asi no hay ningun
 * parametro que manipular.
 */
exports.getMisNotificaciones = async (req, res) => {
    try {
        const soloNoLeidas = String(req.query.no_leidas) === 'true';
        const limit = Math.min(100, Number.parseInt(req.query.limit, 10) || 30);

        const bandeja = await notificationsService.obtenerBandeja(req.user.id, {
            soloNoLeidas,
            limit
        });

        res.status(200).json(bandeja);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/** PATCH /api/notifications/:id/leida */
exports.marcarLeida = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ msg: "Id invalido" });

        const actualizada = await notificationsService.marcarLeida(req.user.id, id);

        // Un 404 aca cubre dos casos que no conviene distinguir: que la
        // notificacion no exista, y que exista pero sea de otro usuario.
        // Diferenciarlos permitiria sondear ids ajenos.
        if (!actualizada) {
            return res.status(404).json({ msg: "Notificacion no encontrada o ya leida" });
        }

        res.status(200).json(actualizada);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/notifications/eventos/estado
 *
 * Diagnostico de la cola: cuantos eventos hay en cada estado, que eventos
 * tienen suscriptor y cuales fueron los ultimos fallidos.
 *
 * En una arquitectura de eventos esto no es un lujo. Cuando algo "no paso"
 * (no llegaron los puntos, no salio el aviso), la causa esta en la cola y no
 * en el endpoint que el usuario toco: sin esta ventana habria que entrar a
 * la base a mano para saberlo.
 */
exports.getEstadoDeEventos = async (req, res) => {
    try {
        res.status(200).json(await eventBus.estadoDeLaCola());
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
