const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// El diagnostico va ANTES que /:id: si no, Express leeria "eventos" como un id.
router.get('/eventos/estado', verifyToken(['admin']), notificationController.getEstadoDeEventos);

router.get('/', verifyToken(), notificationController.getMisNotificaciones);
router.patch('/:id/leida', verifyToken(), notificationController.marcarLeida);

module.exports = router;
