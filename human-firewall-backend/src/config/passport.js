const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('./db');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy_client_id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy_client_secret',
    callbackURL: "/api/sso/google/callback"
  },
  async function(accessToken, refreshToken, profile, cb) {
      try {
          const email = profile.emails[0].value;
          
          // Verificar si usuario existe
          const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [email]);
          
          let user;
          
          if (rows.length === 0) {
              // Crear usuario automáticamente (US3)
              const result = await db.query(
                  "INSERT INTO users (email, role, oauth_provider, oauth_id) VALUES ($1, $2, $3, $4) RETURNING *",
                  [email, 'employee', 'google', profile.id]
              );
              user = result.rows[0];
          } else {
              user = rows[0];
              // Actualizar provider si faltaba
              if (!user.oauth_provider) {
                  await db.query(
                      "UPDATE users SET oauth_provider = $1, oauth_id = $2 WHERE id = $3",
                      ['google', profile.id, user.id]
                  );
              }
          }
          
          return cb(null, user);
      } catch (err) {
          return cb(err, null);
      }
  }
));

module.exports = passport;
