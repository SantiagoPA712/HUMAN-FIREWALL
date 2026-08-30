const express = require('express');
const router = express.Router();

const userController = require('../controllers/user.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// RH tambien puede consultar y organizar el padron: es quien carga a la gente
// y la reparte por equipos. El alta y la baja siguen siendo solo de admin,
// porque implican crear credenciales y quitar accesos.
router.get('/teams', verifyToken(['admin', 'rh']), userController.getTeams);
router.get('/', verifyToken(['admin', 'rh']), userController.getAll);
router.put('/:id', verifyToken(['admin', 'rh']), userController.updateUser);

router.post('/', verifyToken(['admin']), userController.create);
router.delete('/:id', verifyToken(['admin']), userController.deactivateUser);

module.exports = router;