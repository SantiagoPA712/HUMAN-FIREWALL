const express = require('express');
const router = express.Router();
const simulationController = require('../controllers/simulation.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Rutas genéricas.
// El listado y submit-decision van ANTES que /:simulationId: si no, Express
// leería "submit-decision" como un id de simulación y nunca llegarían acá.
router.get('/', verifyToken(), simulationController.listSimulations);
router.post('/submit-decision', verifyToken(), simulationController.submitDecision);
router.post('/:simulationId/complete', verifyToken(), simulationController.completeSimulation);
router.get('/:simulationId', verifyToken(), simulationController.getSimulationDetails);

// Creación por Administradores / Instructores
router.post('/', verifyToken(['admin', 'instructor']), simulationController.createSimulation);
router.post('/:simulationId/steps', verifyToken(['admin', 'instructor']), simulationController.addStep);
router.post('/steps/:stepId/options', verifyToken(['admin', 'instructor']), simulationController.addOption);

module.exports = router;
