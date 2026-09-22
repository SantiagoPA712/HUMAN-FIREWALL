/**
 * Centro de notificaciones de resultados y su configuracion.
 *
 * Igual que en el resto del proyecto, aca no hay verificacion de rol: la
 * configuracion de cursos criticos se corta en el middleware, antes de entrar
 * (ver notification.routes.js). Lo que si vive aca es la regla de que nadie
 * consulta ni configura por otro: el id sale del token, nunca de la URL.
 */

const resultNotifications = require('../services/resultNotifications.service');

/**
 * GET /api/notifications/resultados
 *
 * Criterio de aceptacion 3: listado cronologico de resultados notificados,
 * marcados como leidos o no leidos.
 */
exports.getCentro = async (req, res) => {
    try {
        const soloNoLeidas = String(req.query.no_leidas) === 'true';
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));

        res.status(200).json(
            await resultNotifications.obtenerCentro(req.user.id, { soloNoLeidas, limit })
        );
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * PATCH /api/notifications/leidas
 * Criterio de aceptacion 3: marcar todas como leidas de una vez.
 */
exports.marcarTodasLeidas = async (req, res) => {
    try {
        res.status(200).json(await resultNotifications.marcarTodasLeidas(req.user.id));
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/notifications/preferencias
 * Canales habilitados del usuario autenticado (criterio tecnico 3).
 */
exports.getPreferencias = async (req, res) => {
    try {
        res.status(200).json(await resultNotifications.obtenerPreferencias(req.user.id));
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/** PATCH /api/notifications/preferencias  Body: { in_app?, email? } */
exports.patchPreferencias = async (req, res) => {
    try {
        res.status(200).json(
            await resultNotifications.actualizarPreferencias(req.user.id, req.body || {})
        );
    } catch (error) {
        if (error.codigo === 400) {
            return res.status(400).json({ msg: error.message, errores: error.errores });
        }
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/notifications/cursos-criticos
 *
 * Catalogo de cursos con su marca de critico, para que RH configure cuales
 * disparan alerta (criterio de aceptacion 2).
 */
exports.getCursosCriticos = async (req, res) => {
    try {
        const cursos = await resultNotifications.listarCursos();
        res.status(200).json({
            total: cursos.length,
            criticos: cursos.filter(c => c.is_critical).length,
            cursos
        });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/** PATCH /api/notifications/cursos-criticos/:courseId  Body: { is_critical } */
exports.patchCursoCritico = async (req, res) => {
    try {
        const courseId = Number.parseInt(req.params.courseId, 10);
        if (!Number.isInteger(courseId) || courseId <= 0) {
            return res.status(400).json({ msg: 'Id de curso invalido' });
        }

        if (typeof req.body?.is_critical !== 'boolean') {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{ campo: 'is_critical', detalle: 'Debe ser true o false.' }]
            });
        }

        const curso = await resultNotifications.marcarCursoCritico(courseId, req.body.is_critical);
        if (!curso) return res.status(404).json({ msg: `No existe el curso ${courseId}` });

        res.status(200).json(curso);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
