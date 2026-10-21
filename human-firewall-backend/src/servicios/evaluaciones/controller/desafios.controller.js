/**
 * Controlador HTTP de los desafios del portal.
 *
 * Atiende POST /api/gamification/challenge. La URL se conserva por
 * compatibilidad con el frontend (lib/api.js -> registrarDesafio), pero el
 * caso de uso pertenece a evaluaciones: registra un intento.
 */

const desafios = require('../application/desafios.service');
const { responderError, ErrorHttp } = require('../../../compartido/http/errores');

exports.completeChallenge = async (req, res) => {
    try {
        const { challengeId, passed, score } = req.body || {};
        if (!challengeId) {
            throw ErrorHttp.validacion([{ campo: 'challengeId', detalle: 'Es obligatorio.' }], 'El ID del desafío es obligatorio');
        }
        res.status(200).json(await desafios.registrarResultado(req.user.id, { challengeId, passed, score }));
    } catch (error) {
        responderError(req, res, error);
    }
};
