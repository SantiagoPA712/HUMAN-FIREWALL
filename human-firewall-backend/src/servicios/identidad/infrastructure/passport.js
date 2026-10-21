/**
 * Integracion con Google OAuth (passport).
 *
 * Capa Infrastructure: adapta la estrategia de passport al caso de uso
 * application/sso.service.js -> ingresarConGoogle(), que crea la cuenta en
 * el primer ingreso. Las credenciales salen de config/configuracion.js.
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const config = require('../config/configuracion');
const sso = require('../application/sso.service');

passport.use(new GoogleStrategy({
    clientID: config.google.clientId,
    clientSecret: config.google.clientSecret,
    callbackURL: config.google.callbackUrl
}, async (accessToken, refreshToken, profile, cb) => {
    try {
        const user = await sso.ingresarConGoogle({ email: profile.emails[0].value, oauthId: profile.id });
        return cb(null, user);
    } catch (err) {
        return cb(err, null);
    }
}));

module.exports = passport;
