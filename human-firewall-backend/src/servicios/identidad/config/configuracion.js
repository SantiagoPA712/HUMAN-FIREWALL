/**
 * Configuracion del servicio de identidad.
 *
 * Equivale al application.yml de cada microservicio del material (seccion
 * 11): el nombre del servicio y los parametros que lee del entorno, con su
 * valor por defecto. El resto del servicio importa de aca en lugar de leer
 * process.env suelto. Los secretos (JWT_SECRET) no tienen defecto: los lee
 * compartido/config/entorno.js y el servidor no arranca sin ellos.
 */

const entorno = require('../../../compartido/config/entorno');

module.exports = {
    nombre: 'identidad',

    /** Horas de vigencia del enlace de una invitacion. */
    get horasDeVigenciaInvitacion() { return entorno.numero('INVITATION_EXPIRY_HOURS', 72); },

    /** Minutos de vigencia del token de recuperacion de contrasena. */
    minutosDeVigenciaRecuperacion: 60,

    /** Google OAuth: sin ellos funciona todo salvo "entrar con Google". */
    google: {
        get clientId() { return entorno.texto('GOOGLE_CLIENT_ID', 'dummy_client_id'); },
        get clientSecret() { return entorno.texto('GOOGLE_CLIENT_SECRET', 'dummy_client_secret'); },
        callbackUrl: '/api/sso/google/callback'
    }
};
