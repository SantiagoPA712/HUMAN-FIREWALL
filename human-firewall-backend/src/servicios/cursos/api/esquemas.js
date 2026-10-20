/**
 * DTO del servicio de cursos: la forma de lo que acepta cada endpoint.
 *
 * Los usa el middleware validar() en las rutas y el contrato OpenAPI los
 * publica tal cual. Ver compartido/http/validacion.js.
 */

const { idEntero, paramsId } = require('../../../compartido/http/validacion');

const crearCurso = {
    body: {
        type: 'object',
        required: ['title'],
        properties: {
            title: { type: 'string', minLength: 1, maxLength: 255, examples: ['Phishing basico'] },
            description: { type: ['string', 'null'], examples: ['Como reconocer un correo fraudulento'] }
        }
    }
};

const agregarContenido = {
    params: paramsId('courseId'),
    body: {
        type: 'object',
        required: ['content_type', 'body'],
        properties: {
            content_type: { type: 'string', minLength: 1, maxLength: 50, examples: ['video'] },
            body: { type: 'string', minLength: 1, examples: ['https://...'] },
            order_idx: { type: 'integer', minimum: 0, default: 0 },
            points_reward: { type: 'integer', minimum: 0, default: 10 }
        }
    }
};

const asignarCurso = {
    body: {
        type: 'object',
        required: ['course_id', 'user_id'],
        properties: {
            course_id: idEntero,
            user_id: idEntero,
            due_date: {
                type: ['string', 'null'],
                description: 'Fecha limite ISO 8601. Vacio o null: sin fecha limite.',
                examples: ['2026-12-01T23:59:00Z']
            }
        }
    }
};

const porCurso = { params: paramsId('courseId') };
const porContenido = { params: paramsId('contentId') };

module.exports = { crearCurso, agregarContenido, asignarCurso, porCurso, porContenido };
