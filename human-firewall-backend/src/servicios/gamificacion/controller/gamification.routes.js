/**
 * Rutas del servicio de gamificacion, montadas en /api/gamification.
 *
 * Bajo el mismo prefijo /api/gamification responden tambien otros servicios
 * (la URL se conserva por compatibilidad con el frontend):
 *
 *   /api/gamification/challenge  -> evaluaciones
 *   /api/gamification/reports/*  -> reportes
 *   /api/gamification/security/* -> seguridad
 *   /api/gamification/users/*    -> seguridad (ajuste manual auditado)
 *
 * Cada uno monta su propio router en app.js; este archivo solo tiene lo que
 * es de gamificacion.
 */

const express = require('express');
const router = express.Router();
const controller = require('./gamification.controller');
const esquemas = require('./dto');
const { verifyToken } = require('../../../compartido/middlewares/auth.middleware');
const { selfOrRoles } = require('../../../compartido/middlewares/role.middleware');
const { validar } = require('../../../compartido/http/validacion');

// El propio usuario, admin o rh. selfOrRoles corre despues de verifyToken.
const propioOGestion = [verifyToken(), selfOrRoles(['admin', 'rh'], 'userId')];

router.get('/leaderboard', verifyToken(), controller.getLeaderboard);
router.get('/me', verifyToken(), controller.getMyStatus);

// Puntos. /points/rules va antes que /points/:userId para que "rules" no se lea como id.
router.get('/points/rules', verifyToken(), controller.getPointsRules);
router.get('/points/:userId', ...propioOGestion, validar(esquemas.paginacion), controller.getUserPoints);

// Recompensas e insignias. El catalogo va antes que /:userId.
router.get('/rewards', verifyToken(), controller.getRewardsCatalog);
router.get('/rewards/:userId', ...propioOGestion, controller.getUserRewards);

// Niveles. La escalera va antes que /:userId.
router.get('/levels', verifyToken(), controller.getLevelsConfig);
router.get('/level/:userId', ...propioOGestion, controller.getUserLevel);

// Desempeno y recomendaciones.
router.get('/performance/:userId', ...propioOGestion, controller.getUserPerformance);
router.get('/recommendations/:userId', ...propioOGestion, controller.getUserRecommendations);

// Administracion del catalogo de insignias y asignacion manual (auditada).
router.post('/badges', verifyToken(['admin']), validar(esquemas.crearInsignia), controller.createBadge);
router.post('/badges/assign', verifyToken(['admin', 'instructor']), validar(esquemas.asignarInsignia), controller.assignBadge);

module.exports = router;
