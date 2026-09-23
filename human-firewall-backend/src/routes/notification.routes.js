const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const resultNotificationsController = require('../controllers/resultNotifications.controller');
const emailNotificationsController = require('../controllers/emailNotifications.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

// El diagnostico va ANTES que /:id: si no, Express leeria "eventos" como un id.
router.get('/eventos/estado', verifyToken(['admin']), notificationController.getEstadoDeEventos);

// ---------------------------------------------------------------------
// Notificacion de resultados (HU: evaluaciones, simulaciones y cursos)
// ---------------------------------------------------------------------
//
// Ninguna de estas rutas recibe un userId: igual que la bandeja general, el
// id sale del token. Una notificacion es del dueno y de nadie mas.
//
// Van antes de '/:id/leida' porque, aunque esa ruta tiene dos segmentos y
// estas uno, el orden deja explicito que 'resultados' y 'preferencias' son
// nombres y no ids.
router.get('/resultados', verifyToken(), resultNotificationsController.getCentro);
router.patch('/leidas', verifyToken(), resultNotificationsController.marcarTodasLeidas);

router.get('/preferencias', verifyToken(), resultNotificationsController.getPreferencias);
router.patch('/preferencias', verifyToken(), resultNotificationsController.patchPreferencias);

// Que cursos disparan alerta a RH. Lo configura RH, no cada usuario: el
// criterio tecnico 2 pide que la resolucion de destinatarios viva en el
// backend, y esta marca es la mitad de esa regla.
const soloRhOAdmin = [verifyToken(), requireRoles(['rh', 'admin'])];

router.get('/cursos-criticos', ...soloRhOAdmin, resultNotificationsController.getCursosCriticos);
router.patch('/cursos-criticos/:courseId', ...soloRhOAdmin, resultNotificationsController.patchCursoCritico);

// ---------------------------------------------------------------------
// Notificaciones por correo (HU: correo ante eventos relevantes)
// ---------------------------------------------------------------------
//
// Las preferencias por TIPO de correo. Las de arriba (/preferencias) son por
// CANAL; las dos conviven y las dos se respetan al encolar.
router.get('/correo/preferencias', verifyToken(), emailNotificationsController.getPreferencias);
router.patch('/correo/preferencias', verifyToken(), emailNotificationsController.patchPreferencias);
router.get('/correo/estado', verifyToken(['admin']), emailNotificationsController.getEstado);

router.get('/', verifyToken(), notificationController.getMisNotificaciones);
router.patch('/:id/leida', verifyToken(), notificationController.marcarLeida);

module.exports = router;
