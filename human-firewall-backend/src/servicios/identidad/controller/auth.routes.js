/**
 * Rutas de autenticacion, montadas en /api/auth. Todas publicas.
 *
 * login y register validan su cuerpo en el controlador (la pantalla muestra
 * esos mensajes tal cual); el esquema se publica en el contrato.
 */

const express = require('express');
const router = express.Router();
const controller = require('./auth.controller');
const esquemas = require('./dto');
const { loginLimiter } = require('../../../compartido/middlewares/rateLimit.middleware');
const { validar } = require('../../../compartido/http/validacion');

router.post('/login', loginLimiter, controller.login);
router.post('/logout', controller.logout);
router.post('/register', controller.register);

router.post('/forgot-password', validar(esquemas.olvideContrasena), controller.forgotPassword);
router.post('/reset-password', validar(esquemas.restablecerContrasena), controller.resetPassword);

module.exports = router;
