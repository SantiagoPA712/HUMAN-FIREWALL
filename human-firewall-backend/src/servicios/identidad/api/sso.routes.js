/**
 * Rutas de inicio de sesion con Google, montadas en /api/sso.
 */

const express = require('express');
const passport = require('passport');
const { generateToken } = require('../../../compartido/utils/token');

const router = express.Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', 
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=sso_failed' }),
  function(req, res) {
      // Éxito en la autenticación (US3)
      const token = generateToken({
          id: req.user.id,
          role: req.user.role
      });
      
      // Pasar token al frontend (redirección)
      res.redirect(`/dashboard?token=${token}`);
  }
);

module.exports = router;
