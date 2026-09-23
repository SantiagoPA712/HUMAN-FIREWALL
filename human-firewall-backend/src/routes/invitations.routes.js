const express = require('express');
const router = express.Router();

const invitationsController = require('../controllers/invitations.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { invitationLimiter } = require('../middlewares/rateLimit.middleware');

// ---------------------------------------------------------------------
// Invitado: sin sesion, el token del correo es la credencial.
// ---------------------------------------------------------------------
//
// Con limite de pedidos por IP: son las unicas rutas de la HU que cualquiera
// puede llamar, y sin el limite se podria probar tokens en rafaga.
router.post('/validar', invitationLimiter, invitationsController.validar);
router.post('/aceptar', invitationLimiter, invitationsController.aceptar);
router.post('/solicitar-reenvio', invitationLimiter, invitationsController.solicitarReenvio);

// ---------------------------------------------------------------------
// Administrador. El rol se verifica en el middleware, antes de tocar la base.
// ---------------------------------------------------------------------
const soloAdmin = verifyToken(['admin']);

router.get('/', soloAdmin, invitationsController.listar);
router.post('/', soloAdmin, invitationsController.invitar);
router.post('/:id/reenviar', soloAdmin, invitationsController.reenviar);
router.post('/:id/cancelar', soloAdmin, invitationsController.cancelar);

module.exports = router;
