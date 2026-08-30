const express = require('express');
const router = express.Router();
const gamificationController = require('../controllers/gamification.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { selfOrRoles, requireRoles } = require('../middlewares/role.middleware');
const reportController = require('../controllers/report.controller');
const securityController = require('../controllers/security.controller');

// Rutas de Gamificación y Desempeño
router.get('/leaderboard', verifyToken(), gamificationController.getLeaderboard);
router.get('/me', verifyToken(), gamificationController.getMyStatus);

// Historial de puntos (HU: asignación automática de puntos)
// selfOrRoles corre después de verifyToken: el propio usuario, admin o rh.
router.get('/points/rules', verifyToken(), gamificationController.getPointsRules);
router.get('/points/:userId',
    verifyToken(),
    selfOrRoles(['admin', 'rh'], 'userId'),
    gamificationController.getUserPoints
);

// Recompensas e insignias (HU: recompensas por cumplimiento de logros)
// El catalogo va antes que /:userId para que "rewards" no se lea como un id.
router.get('/rewards', verifyToken(), gamificationController.getRewardsCatalog);
router.get('/rewards/:userId',
    verifyToken(),
    selfOrRoles(['admin', 'rh'], 'userId'),
    gamificationController.getUserRewards
);

// Nivel y progreso (HU: nivel actual y avance hacia el siguiente)
// La escalera va antes que /:userId para que "levels" no se lea como un id.
router.get('/levels', verifyToken(), gamificationController.getLevelsConfig);
router.get('/level/:userId',
    verifyToken(),
    selfOrRoles(['admin', 'rh'], 'userId'),
    gamificationController.getUserLevel
);

// Desempeño y recomendaciones (HU: cómo mejorar mi desempeño)
router.get('/performance/:userId',
    verifyToken(),
    selfOrRoles(['admin', 'rh'], 'userId'),
    gamificationController.getUserPerformance
);

// Recomendaciones precalculadas por eventos (proyeccion de user_recommendations)
router.get('/recommendations/:userId',
    verifyToken(),
    selfOrRoles(['admin', 'rh'], 'userId'),
    gamificationController.getUserRecommendations
);

// ---------------------------------------------------------------------
// Reportes de desempeño (HU: reportes para RH)
// ---------------------------------------------------------------------
//
// Criterio técnico 1: el rol se verifica en el MIDDLEWARE, antes de llegar al
// controlador y sin ejecutar ninguna consulta al reporte.
//
//   verifyToken()  -> valida la firma del JWT y llena req.user
//   requireRoles() -> corta con 403 si el claim role no es rh ni admin
//
// requireRoles y no selfOrRoles: un reporte de toda la organización no tiene
// "dueño", así que la excepción del propio usuario no aplica. Un empleado no
// puede ver el desempeño del resto ni pasando su propio id.
//
// No hay riesgo de colisión con las rutas /:userId de más arriba: todas
// cuelgan de un prefijo distinto (/points, /rewards, /level, /performance),
// y ninguna captura /reports/*.
const soloRH = [verifyToken(), requireRoles(['rh', 'admin'])];

router.get('/reports/filters', ...soloRH, reportController.getReportFilters);
router.get('/reports/performance', ...soloRH, reportController.getPerformanceReport);
router.post('/reports/performance/export', ...soloRH, reportController.exportPerformanceReport);

// El :exportId es el uid aleatorio, no el id secuencial de la tabla.
router.get('/reports/exports/:exportId', ...soloRH, reportController.getExportStatus);
router.get('/reports/exports/:exportId/download', ...soloRH, reportController.downloadExport);

// ---------------------------------------------------------------------
// Seguridad: anomalías y auditoría (HU: detección de abuso de puntos)
// ---------------------------------------------------------------------
//
// Criterio técnico 3: el rol se verifica en el MIDDLEWARE, antes del
// controlador y sin ejecutar ninguna consulta. Mismo patrón que reportes.
const soloSeguridad = [verifyToken(), requireRoles(['security', 'admin'])];

router.get('/security/rules', ...soloSeguridad, securityController.getAnomalyRules);
router.get('/security/audit', ...soloSeguridad, securityController.listAuditLog);
router.get('/security/anomalies', ...soloSeguridad, securityController.listAnomalies);
router.get('/security/anomalies/:id', ...soloSeguridad, securityController.getAnomaly);
router.patch('/security/anomalies/:id/status', ...soloSeguridad, securityController.updateAnomalyStatus);

// Ajuste manual de puntos, nivel o insignias.
//
// Solo admin: seguridad AUDITA los ajustes, no los ejecuta. Darle a quien
// investiga la capacidad de modificar lo investigado anula el control.
router.patch('/users/:id/adjust',
    verifyToken(),
    requireRoles(['admin']),
    securityController.adjustUser
);

// Administración de insignias y recompensas
router.post('/badges', verifyToken(['admin']), gamificationController.createBadge);
router.post('/badges/assign', verifyToken(['admin', 'instructor']), gamificationController.assignBadge);

// Endpoint Seguro para retribuir desafíos y minijuegos del Portal
router.post('/challenge', verifyToken(), gamificationController.completeChallenge);

module.exports = router;
