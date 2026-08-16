const express = require('express');
const router = express.Router();
const gamificationController = require('../controllers/gamification.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { selfOrRoles } = require('../middlewares/role.middleware');

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

// Administración de insignias y recompensas
router.post('/badges', verifyToken(['admin']), gamificationController.createBadge);
router.post('/badges/assign', verifyToken(['admin', 'instructor']), gamificationController.assignBadge);

// Endpoint Seguro para retribuir desafíos y minijuegos del Portal
router.post('/challenge', verifyToken(), gamificationController.completeChallenge);

module.exports = router;
