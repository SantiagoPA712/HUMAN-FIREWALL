/**
 * Ruta de desafios del portal, montada en /api/gamification/challenge.
 */

const express = require('express');
const router = express.Router();
const controller = require('./desafios.controller');
const esquemas = require('./esquemas');
const { verifyToken } = require('../../../compartido/middlewares/auth.middleware');
const { validar } = require('../../../compartido/http/validacion');

router.post('/', verifyToken(), validar(esquemas.registrarDesafio), controller.completeChallenge);

module.exports = router;
