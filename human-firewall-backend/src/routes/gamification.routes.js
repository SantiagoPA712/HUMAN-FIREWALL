const express = require('express');
const router = express.Router();
const gamificationController = require('../controllers/gamification.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Rutas de Gamificación y Desempeño
router.get('/leaderboard', verifyToken(), gamificationController.getLeaderboard);
router.get('/me', verifyToken(), gamificationController.getMyStatus);

// Administración de insignias y recompensas
router.post('/badges', verifyToken(['admin']), gamificationController.createBadge);
router.post('/badges/assign', verifyToken(['admin', 'instructor']), gamificationController.assignBadge);

// Endpoint Seguro para retribuir desafíos y minijuegos del Portal
router.post('/challenge', verifyToken(), gamificationController.completeChallenge);

module.exports = router;
