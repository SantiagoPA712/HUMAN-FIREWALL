/**
 * DTO del servicio de seguridad. Ver compartido/http/validacion.js.
 *
 * Los listados (anomalias, auditoria, logs) ya validaban sus filtros dentro
 * del servicio, con mensajes por campo que las pantallas muestran. Sus
 * esquemas de query se publican en el contrato pero no se enganchan como
 * middleware, para no duplicar la validacion con mensajes distintos.
 */

const { idEntero, paramsId } = require('../../../compartido/http/validacion');

const ESTADOS_ANOMALIA = ['pending', 'reviewed', 'dismissed'];
const SEVERIDADES = ['low', 'medium', 'high', 'critical'];
const TIPOS_DE_AJUSTE = ['points', 'level', 'badge'];

const pagina = { type: 'integer', minimum: 1, default: 1 };
const tamanoPagina = { type: 'integer', minimum: 1, maximum: 100, default: 25 };

const listarAnomalias = {
    query: {
        type: 'object',
        properties: {
            status: { type: 'string', enum: ESTADOS_ANOMALIA },
            severity: { type: 'string', enum: SEVERIDADES },
            user_id: { type: 'integer', minimum: 1 },
            page: pagina,
            page_size: tamanoPagina
        }
    }
};

const listarAuditoria = {
    query: {
        type: 'object',
        properties: {
            actor_id: { type: 'integer', minimum: 1 },
            target_user_id: { type: 'integer', minimum: 1 },
            change_type: { type: 'string', enum: [...TIPOS_DE_AJUSTE, 'anomaly_status'] },
            page: pagina,
            page_size: tamanoPagina
        }
    }
};

const porId = { params: paramsId('id') };

const cambiarEstado = {
    params: paramsId('id'),
    body: {
        type: 'object',
        required: ['status'],
        properties: {
            status: { type: 'string', enum: ESTADOS_ANOMALIA },
            note: { type: ['string', 'null'], maxLength: 2000 }
        }
    }
};

const ajustarUsuario = {
    params: paramsId('id'),
    body: {
        type: 'object',
        required: ['change_type', 'value', 'reason'],
        properties: {
            change_type: { type: 'string', enum: TIPOS_DE_AJUSTE },
            value: {
                type: ['integer', 'string'],
                description: 'points: entero distinto de cero (puede ser negativo). level: numero de nivel. badge: id de la recompensa.',
                examples: [50]
            },
            reason: { type: 'string', minLength: 1, description: 'Obligatorio: sin motivo el ajuste no se ejecuta' }
        }
    }
};

const filtrosDeLogs = {
    query: {
        type: 'object',
        properties: {
            from: { type: 'string', description: 'YYYY-MM-DD o fecha-hora ISO' },
            to: { type: 'string', description: 'YYYY-MM-DD o fecha-hora ISO' },
            user_id: { type: 'string', description: 'Id de usuario o "system"' },
            module: { type: 'string', enum: ['auth', 'users', 'gamification', 'security', 'reports', 'logs', 'system'] },
            action_type: { type: 'string' },
            resource_type: { type: 'string' },
            order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            page: pagina,
            page_size: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
        }
    }
};

module.exports = {
    ESTADOS_ANOMALIA,
    SEVERIDADES,
    TIPOS_DE_AJUSTE,
    listarAnomalias,
    listarAuditoria,
    porId,
    cambiarEstado,
    ajustarUsuario,
    filtrosDeLogs,
    idEntero
};
