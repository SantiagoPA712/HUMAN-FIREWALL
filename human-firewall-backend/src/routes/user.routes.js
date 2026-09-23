const express = require('express');
const router = express.Router();

const userController = require('../controllers/user.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Perfil propio: cualquier usuario autenticado, el id sale del token. Va
// antes de '/:id' para que "me" no se lea como un id.
router.get('/me', verifyToken(), userController.getMe);
router.patch('/me', verifyToken(), userController.updateMe);

router.post('/', verifyToken(['admin']), userController.create);
router.get('/', verifyToken(['admin']), userController.getAll);
router.put('/:id', verifyToken(['admin']), userController.updateUser);
router.delete('/:id', verifyToken(['admin']), userController.deactivateUser);

module.exports = router;