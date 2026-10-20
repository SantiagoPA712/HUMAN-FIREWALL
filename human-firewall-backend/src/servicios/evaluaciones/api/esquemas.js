/**
 * DTO del servicio de evaluaciones. Ver compartido/http/validacion.js.
 */

const { idEntero, paramsId } = require('../../../compartido/http/validacion');

const DIFICULTADES = ['beginner', 'intermediate', 'advanced'];

const crearSimulacion = {
    body: {
        type: 'object',
        required: ['title'],
        properties: {
            title: { type: 'string', minLength: 1, maxLength: 255, examples: ['Correo del banco'] },
            description: { type: ['string', 'null'] },
            difficulty: { type: 'string', maxLength: 50, examples: DIFICULTADES, default: 'beginner' }
        }
    }
};

const agregarPaso = {
    params: paramsId('simulationId'),
    body: {
        type: 'object',
        required: ['scenario_text'],
        properties: {
            scenario_text: { type: 'string', minLength: 1 },
            order_idx: { type: 'integer', minimum: 0, default: 1 }
        }
    }
};

const agregarOpcion = {
    params: paramsId('stepId'),
    body: {
        type: 'object',
        required: ['option_text'],
        properties: {
            option_text: { type: 'string', minLength: 1 },
            is_correct: { type: 'boolean', default: false },
            points_awarded: { type: 'integer', minimum: 0, default: 0 },
            feedback_text: { type: ['string', 'null'] }
        }
    }
};

const registrarDecision = {
    body: {
        type: 'object',
        required: ['optionId'],
        properties: { optionId: idEntero }
    }
};

const completarSimulacion = {
    params: paramsId('simulationId'),
    body: {
        type: 'object',
        required: ['decisiones'],
        properties: {
            decisiones: {
                type: 'array',
                minItems: 1,
                items: idEntero,
                description: 'Ids de las opciones elegidas, una por paso',
                examples: [[3, 7, 12]]
            }
        }
    }
};

const porSimulacion = { params: paramsId('simulationId') };

const registrarDesafio = {
    body: {
        type: 'object',
        required: ['challengeId'],
        properties: {
            challengeId: { type: 'string', minLength: 1, maxLength: 100, examples: ['phishing-email-1'] },
            passed: { type: 'boolean', description: 'Resultado real. Si no se envia se asume aprobado (cliente viejo).' },
            score: { type: 'integer', minimum: 0, maximum: 100 }
        }
    }
};

module.exports = {
    crearSimulacion,
    agregarPaso,
    agregarOpcion,
    registrarDecision,
    completarSimulacion,
    porSimulacion,
    registrarDesafio
};
