/**
 * DTO del servicio de gamificacion. Ver compartido/http/validacion.js.
 */

const { idEntero, paramsId } = require('../../../compartido/http/validacion');

const TIPOS_DE_CONDICION = [
    'points_total', 'lessons_completed', 'courses_completed', 'quizzes_approved', 'quiz_streak'
];

const porUsuario = { params: paramsId('userId') };

const paginacion = {
    params: paramsId('userId'),
    query: {
        type: 'object',
        properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
    }
};

const crearInsignia = {
    body: {
        type: 'object',
        required: ['name'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, examples: ['Detector de phishing'] },
            description: { type: ['string', 'null'] },
            icon_url: { type: ['string', 'null'], maxLength: 255 },
            condition_type: { type: 'string', enum: TIPOS_DE_CONDICION, default: 'points_total' },
            threshold: { type: 'integer', minimum: 0, description: 'Valor a alcanzar en la unidad de condition_type' },
            points_required: { type: 'integer', minimum: 0, deprecated: true, description: 'Alias viejo de threshold' },
            is_repeatable: { type: 'boolean', default: false }
        }
    }
};

const asignarInsignia = {
    body: {
        type: 'object',
        required: ['user_id', 'reason'],
        properties: {
            user_id: idEntero,
            reward_id: idEntero,
            badge_id: { ...idEntero, deprecated: true, description: 'Alias viejo de reward_id' },
            reason: { type: 'string', minLength: 1, description: 'Motivo obligatorio: toda asignacion manual queda auditada' }
        },
        anyOf: [{ required: ['reward_id'] }, { required: ['badge_id'] }]
    }
};

module.exports = { TIPOS_DE_CONDICION, porUsuario, paginacion, crearInsignia, asignarInsignia };
