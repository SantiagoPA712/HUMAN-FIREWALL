/**
 * Configuracion del servicio de notificaciones (equivale al application.yml
 * de la seccion 11 del material). Todo lo que el servicio lee del entorno
 * esta aca; las capas de abajo piden `config.smtp.host` y no process.env.
 *
 * Son getters: se leen en el momento, asi un cambio de .env (o una prueba que
 * fija una variable) se respeta sin reiniciar el modulo.
 */

const entorno = require('../../../compartido/config/entorno');
const bases = require('../../../compartido/config/bases');

module.exports = {
    nombre: 'notificaciones',

    /**
     * Base de datos propia del servicio (el spring.datasource.url del
     * application.yml del material): NOTIFICACIONES_DATABASE_URL, o la de DATABASE_URL con el
     * sufijo _notificaciones cuando BASES_POR_SERVICIO=true.
     */
    get baseDeDatos() { return entorno.texto('NOTIFICACIONES_DATABASE_URL', bases.urlPorDefecto('notificaciones')); },

    /** Servidor de correo. Sin host, los correos quedan en 'skipped'. */
    smtp: {
        get host() { return entorno.texto('SMTP_HOST', ''); },
        get port() { return entorno.numero('SMTP_PORT', 587); },
        get secure() { return String(process.env.SMTP_SECURE) === 'true'; },
        get user() { return entorno.texto('SMTP_USER', ''); },
        get pass() { return entorno.texto('SMTP_PASS', ''); }
    },

    /** Remitente de los correos. */
    get remitente() { return entorno.texto('MAIL_FROM', 'Human Firewall <no-reply@humanfirewall.local>'); },

    /** Contra que se arman los enlaces de los correos. */
    get urlBase() { return entorno.texto('APP_BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''); },

    /** Idioma de la plataforma cuando el usuario no eligio uno. */
    get idiomaPorDefecto() { return entorno.texto('DEFAULT_LANGUAGE', 'es').toLowerCase(); },

    /** Zona horaria con la que se muestran las fechas en los correos. */
    get zonaHoraria() { return entorno.texto('APP_TIMEZONE', 'America/Bogota'); },

    /** Base del backoff exponencial de los reintentos de correo. */
    get segundosBaseDeReintento() { return entorno.numero('EMAIL_RETRY_BASE_SECONDS', 30); },

    /** Cada cuanto corre el worker de la cola de correos. */
    get segundosEntreCorridasDelWorker() { return entorno.numero('EMAIL_WORKER_INTERVAL_SECONDS', 15); }
};
