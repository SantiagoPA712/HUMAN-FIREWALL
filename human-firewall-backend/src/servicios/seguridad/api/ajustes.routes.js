/**
 * Ajuste manual de puntos, nivel o insignias, montado en
 * /api/gamification/users.
 *
 * Solo admin: seguridad AUDITA los ajustes, no los ejecuta. Darle a quien
 * investiga la capacidad de modificar lo investigado anula el control.
 */

const express = require('express');
const router = express.Router();
const controller = require('./security.controller');
const esquemas = require('./esquemas');
const { verifyToken } = require('../../../compartido/middlewares/auth.middleware');
const { requireRoles } = require('../../../compartido/middlewares/role.middleware');
const { validar } = require('../../../compartido/http/validacion');

router.patch('/:id/adjust', verifyToken(), requireRoles(['admin']), validar(esquemas.ajustarUsuario), controller.adjustUser);

module.exports = router;
