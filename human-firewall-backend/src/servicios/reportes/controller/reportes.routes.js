/**
 * Rutas del servicio de reportes, montadas en /api/gamification/reports.
 *
 * La URL se conserva por compatibilidad con el frontend: antes estas rutas
 * vivian dentro de gamification.routes.js. El rol se verifica SIEMPRE en el
 * middleware, antes del controlador y sin ejecutar ninguna consulta
 * (criterio tecnico 1 de las HU de reportes).
 *
 * Los filtros de cada reporte los valida el servicio, con el detalle por
 * campo que muestra la pantalla; sus esquemas se publican en el contrato.
 */

const express = require('express');
const router = express.Router();
const reportController = require('./report.controller');
const scheduledReportsController = require('./scheduledReports.controller');
const orgReportsController = require('./orgReports.controller');
const { verifyToken } = require('../../../compartido/middlewares/auth.middleware');
const { requireRoles } = require('../../../compartido/middlewares/role.middleware');

// Reporte de desempeno: RH y admin. requireRoles y no selfOrRoles: un
// reporte de toda la organizacion no tiene "dueno".
const soloRH = [verifyToken(), requireRoles(['rh', 'admin'])];

router.get('/filters', ...soloRH, reportController.getReportFilters);
router.get('/performance', ...soloRH, reportController.getPerformanceReport);
router.post('/performance/export', ...soloRH, reportController.exportPerformanceReport);

// El :exportId es el uid aleatorio, no el id secuencial de la tabla.
router.get('/exports/:exportId', ...soloRH, reportController.getExportStatus);
router.get('/exports/:exportId/download', ...soloRH, reportController.downloadExport);

// Reportes programados: configurarlos es de admin (403 sin persistir nada).
const soloAdmin = [verifyToken(), requireRoles(['admin'])];

router.get('/schedules', ...soloAdmin, scheduledReportsController.listSchedules);
router.post('/schedules', ...soloAdmin, scheduledReportsController.createSchedule);
router.patch('/schedules/:id', ...soloAdmin, scheduledReportsController.updateSchedule);

// El historico lo consultan los roles que pueden estar suscritos a un reporte.
const destinatarios = [verifyToken(), requireRoles(['rh', 'security', 'manager', 'admin'])];

router.get('/history', ...destinatarios, scheduledReportsController.listHistory);
router.get('/history/:id/download', ...destinatarios, scheduledReportsController.downloadHistoryFile);

// Consolidado organizacional: gerencia y admin, 403 sin ejecutar ninguna agregacion.
router.get('/organizational', verifyToken(), requireRoles(['manager', 'admin']), orgReportsController.getOrganizationalReport);

module.exports = router;
