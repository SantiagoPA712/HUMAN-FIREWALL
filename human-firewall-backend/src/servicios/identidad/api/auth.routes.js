const express = require('express');
const router = express.Router();

const authController = require('./auth.controller');
const { loginLimiter } = require('../../../compartido/middlewares/rateLimit.middleware');

router.post('/login', loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.post('/register', authController.register);

router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;