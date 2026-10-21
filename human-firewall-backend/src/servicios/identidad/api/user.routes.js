/**
 * Rutas de usuarios, montadas en /api/users.
 * Orden: autenticacion -> rol -> validacion del DTO -> controlador.
 */

const express = require('express');
const router = express.Router();
const controller = require('./user.controller');
const esquemas = require('./esquemas');
const { verifyToken } = require('../../../compartido/middlewares/auth.middleware');
const { validar } = require('../../../compartido/http/validacion');

const soloAdmin = verifyToken(['admin']);

// Catalogo de idiomas de la plataforma. Va antes de '/:id' para que
// "idiomas" no se lea como un id, igual que pasa con "me".
router.get('/idiomas', verifyToken(), controller.getIdiomas);

// Perfil propio: el id sale del token. Va antes de '/:id' para que "me" no se lea como id.
router.get('/me', verifyToken(), controller.getMe);
router.patch('/me', verifyToken(), validar(esquemas.actualizarPerfil), controller.updateMe);

router.post('/', soloAdmin, validar(esquemas.crearUsuario), controller.create);
router.get('/', soloAdmin, controller.getAll);
router.put('/:id', soloAdmin, validar(esquemas.actualizarUsuario), controller.updateUser);
router.delete('/:id', soloAdmin, validar(esquemas.porId), controller.deactivateUser);

module.exports = router;
