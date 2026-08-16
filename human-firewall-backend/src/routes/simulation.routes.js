const express = require('express');
const router = express.Router();
const simulationController = require('../controllers/simulation.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Rutas genéricas
router.get('/:simulationId', verifyToken(), simulationController.getSimulationDetails);
router.post('/submit-decision', verifyToken(), simulationController.submitDecision);

// Creación por Administradores / Instructores
router.post('/', verifyToken(['admin', 'instructor']), simulationController.createSimulation);
router.post('/:simulationId/steps', verifyToken(['admin', 'instructor']), simulationController.addStep);
router.post('/steps/:stepId/options', verifyToken(['admin', 'instructor']), simulationController.addOption);

module.exports = router;
