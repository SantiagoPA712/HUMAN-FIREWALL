/**
 * Invitaciones de usuarios (HU de onboarding por invitacion).
 *
 * Dos publicos distintos:
 *   - el administrador, autenticado, que invita, lista, reenvia y cancela;
 *   - el invitado, SIN cuenta todavia, que solo tiene el token del correo.
 *
 * El token del invitado viaja en el CUERPO del POST y nunca en la URL de la
 * API: las URLs quedan en logs de acceso, historiales y cabeceras Referer.
 */

const invitations = require('../services/invitations.service');

/** Responde un error del servicio con su codigo, o 500 si fue inesperado. */
function responderError(res, error) {
    if (error.codigo && error.cuerpo) return res.status(error.codigo).json(error.cuerpo);
    console.error('[invitaciones]', error);
    return res.status(500).json({ msg: 'Error interno al procesar la invitacion' });
}

function idDeRuta(req) {
    const id = Number.parseInt(req.params.id, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------------
// Administrador
// ---------------------------------------------------------------------

/** POST /api/invitations   Body: { email, role, language? } */
exports.invitar = async (req, res) => {
    try {
        const inv = await invitations.invitar(req.body || {}, { adminId: req.user.id, req });
        res.status(201).json(inv);
    } catch (error) {
        responderError(res, error);
    }
};

/** GET /api/invitations?estado=pendiente|aceptada|expirada|cancelada */
exports.listar = async (req, res) => {
    try {
        res.status(200).json(await invitations.listar({ estado: req.query.estado || null }));
    } catch (error) {
        responderError(res, error);
    }
};

/** POST /api/invitations/:id/reenviar */
exports.reenviar = async (req, res) => {
    const id = idDeRuta(req);
    if (!id) return res.status(400).json({ msg: 'Id de invitacion invalido' });
    try {
        res.status(200).json(await invitations.reenviar(id, { adminId: req.user.id, req }));
    } catch (error) {
        responderError(res, error);
    }
};

/** POST /api/invitations/:id/cancelar */
exports.cancelar = async (req, res) => {
    const id = idDeRuta(req);
    if (!id) return res.status(400).json({ msg: 'Id de invitacion invalido' });
    try {
        res.status(200).json(await invitations.cancelar(id, { adminId: req.user.id, req }));
    } catch (error) {
        responderError(res, error);
    }
};

// ---------------------------------------------------------------------
// Invitado (sin autenticacion: el token es la credencial)
// ---------------------------------------------------------------------

/**
 * POST /api/invitations/validar   Body: { token }
 *
 * 200 con correo y rol si se puede mostrar el formulario; 404 si el token no
 * existe; 410 si fue usado, cancelado o vencio (con `motivo`).
 */
exports.validar = async (req, res) => {
    try {
        res.status(200).json(await invitations.validar(req.body?.token));
    } catch (error) {
        responderError(res, error);
    }
};

/**
 * POST /api/invitations/aceptar   Body: { token, password, full_name, language? }
 *
 * 201 con un JWT: el invitado entra directo, igual que con el registro publico.
 */
exports.aceptar = async (req, res) => {
    try {
        const { token, ...datos } = req.body || {};
        const resultado = await invitations.aceptar(token, datos, { req });
        res.status(201).json({ msg: 'Registro completado', ...resultado });
    } catch (error) {
        responderError(res, error);
    }
};

/** POST /api/invitations/solicitar-reenvio   Body: { token } */
exports.solicitarReenvio = async (req, res) => {
    try {
        res.status(202).json(await invitations.solicitarReenvio(req.body?.token));
    } catch (error) {
        responderError(res, error);
    }
};
