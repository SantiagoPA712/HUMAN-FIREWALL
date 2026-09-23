/**
 * Preferencias de correo y diagnostico de la cola (HU de notificaciones por
 * correo).
 *
 * Igual que en el resto del modulo de notificaciones, el id sale del token y
 * nunca de la URL: nadie configura los correos de otro.
 */

const emailNotifications = require('../services/emailNotifications.service');

/**
 * GET /api/notifications/correo/preferencias
 *
 * Criterio de aceptacion 2: que tipos de correo recibe el usuario, cuales son
 * criticos (no desactivables) y en que idioma le llegan.
 */
exports.getPreferencias = async (req, res) => {
    try {
        res.status(200).json(await emailNotifications.obtenerPreferencias(req.user.id));
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * PATCH /api/notifications/correo/preferencias
 * Body: { tipos: { course_assigned: false, ... } }
 *
 * Un tipo critico en false devuelve 400: el criterio de aceptacion 2 dice que
 * no se pueden desactivar, y aceptarlo en silencio haria creer al usuario que
 * lo apago.
 */
exports.patchPreferencias = async (req, res) => {
    try {
        res.status(200).json(
            await emailNotifications.actualizarPreferencias(req.user.id, req.body || {})
        );
    } catch (error) {
        if (error.codigo === 400) {
            return res.status(400).json({ msg: error.message, errores: error.errores });
        }
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/notifications/correo/estado   (solo admin)
 *
 * Cuantos correos hay en cada estado y el detalle de los ultimos fallidos o
 * no entregables, con cada intento y su error tecnico (criterio tecnico 3).
 */
exports.getEstado = async (req, res) => {
    try {
        res.status(200).json(await emailNotifications.estadoDeLaCola());
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
