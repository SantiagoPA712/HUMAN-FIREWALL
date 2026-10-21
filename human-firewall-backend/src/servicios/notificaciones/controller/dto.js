/**
 * DTO del servicio de notificaciones. Ver compartido/http/validacion.js.
 *
 * Las preferencias ya se validaban dentro del servicio (con el detalle por
 * canal o por tipo que muestra la pantalla); sus esquemas se publican en el
 * contrato pero no se enganchan como middleware.
 */

const { paramsId } = require('../../../compartido/http/validacion');

const bandeja = {
    query: {
        type: 'object',
        properties: {
            no_leidas: { type: 'boolean', description: 'true: solo las no leidas' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
        }
    }
};

const porId = { params: paramsId('id') };

const preferenciasDeCanal = {
    body: {
        type: 'object',
        properties: {
            in_app: { type: 'boolean' },
            email: { type: 'boolean' }
        }
    }
};

const preferenciasDeCorreo = {
    body: {
        type: 'object',
        required: ['tipos'],
        properties: {
            tipos: {
                type: 'object',
                additionalProperties: { type: 'boolean' },
                description: 'tipo de correo -> habilitado. Un tipo critico en false responde 400.',
                examples: [{ course_assigned: false }]
            }
        }
    }
};

const cursoCritico = {
    params: paramsId('courseId'),
    body: {
        type: 'object',
        required: ['is_critical'],
        properties: { is_critical: { type: 'boolean' } }
    }
};

module.exports = { bandeja, porId, preferenciasDeCanal, preferenciasDeCorreo, cursoCritico };
