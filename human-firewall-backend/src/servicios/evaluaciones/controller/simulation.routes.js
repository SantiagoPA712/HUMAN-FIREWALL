/**
 * Rutas de simulaciones, montadas en /api/simulations.
 * Orden: autenticacion -> rol -> validacion del DTO -> controlador.
 */

const express = require('express');
const router = express.Router();
const controller = require('./simulation.controller');
const esquemas = require('./dto');
const { verifyToken } = require('../../../compartido/middlewares/auth.middleware');
const { validar } = require('../../../compartido/http/validacion');

const gestores = verifyToken(['admin', 'instructor']);

// El listado y submit-decision van ANTES que /:simulationId: si no, Express
// leeria "submit-decision" como un id de simulacion.
router.get('/', verifyToken(), controller.listSimulations);
router.post('/submit-decision', verifyToken(), validar(esquemas.registrarDecision), controller.submitDecision);
router.post('/:simulationId/complete', verifyToken(), validar(esquemas.completarSimulacion), controller.completeSimulation);
router.get('/:simulationId', verifyToken(), validar(esquemas.porSimulacion), controller.getSimulationDetails);

// Creacion: administradores e instructores.
router.post('/', gestores, validar(esquemas.crearSimulacion), controller.createSimulation);
router.post('/:simulationId/steps', gestores, validar(esquemas.agregarPaso), controller.addStep);
router.post('/steps/:stepId/options', gestores, validar(esquemas.agregarOpcion), controller.addOption);

module.exports = router;
