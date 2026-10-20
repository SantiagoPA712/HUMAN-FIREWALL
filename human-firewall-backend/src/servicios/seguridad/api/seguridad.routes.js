/**
 * Rutas del panel de seguridad, montadas en /api/gamification/security.
 *
 * El rol se verifica en el MIDDLEWARE, antes del controlador y sin ejecutar
 * ninguna consulta (criterio tecnico 3 de la HU de seguridad).
 */

const express = require('express');
const router = express.Router();
const controller = require('./security.controller');
const esquemas = require('./esquemas');
const { verifyToken } = require('../../../compartido/middlewares/auth.middleware');
const { requireRoles } = require('../../../compartido/middlewares/role.middleware');
const { validar } = require('../../../compartido/http/validacion');

const soloSeguridad = [verifyToken(), requireRoles(['security', 'admin'])];

router.get('/rules', ...soloSeguridad, controller.getAnomalyRules);
router.get('/audit', ...soloSeguridad, controller.listAuditLog);
router.get('/anomalies', ...soloSeguridad, controller.listAnomalies);
router.get('/anomalies/:id', ...soloSeguridad, validar(esquemas.porId), controller.getAnomaly);
router.patch('/anomalies/:id/status', ...soloSeguridad, validar(esquemas.cambiarEstado), controller.updateAnomalyStatus);

module.exports = router;
