/**
 * Repositorio de plantillas de correo (servicio de notificaciones).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material):
 * email_templates, versionadas por tipo e idioma.
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/** Plantilla activa de un tipo de correo en un idioma. */
async function plantillaActiva(tipo, lang) {
    const { rows } = await db.query(
            `SELECT id, notification_type, language, version, subject, body_html, body_text
               FROM notificaciones.email_templates
              WHERE notification_type = $1 AND language = $2 AND is_active
              LIMIT 1`,
            [tipo, lang]
        );
    return rows;
}

module.exports = {
    plantillaActiva
};
