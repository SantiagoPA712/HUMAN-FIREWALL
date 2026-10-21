/**
 * Esquemas de entrada del servicio de reportes.
 *
 * Los filtros y las programaciones ya se validaban dentro del servicio
 * (reports.validarFiltros, scheduledReports.validarProgramacion), ANTES de
 * consultar o de escribir, con el detalle por campo que muestra la pantalla.
 * Estos esquemas los publican en el contrato; no se enganchan como
 * middleware para no validar dos veces con mensajes distintos.
 */

const { paramsId } = require('../../../compartido/http/validacion');

const TIPOS = ['performance', 'organizational'];
const FRECUENCIAS = ['daily', 'weekly', 'monthly'];
const FORMATOS = ['csv', 'pdf'];
const ROLES = ['employee', 'instructor', 'admin', 'rh', 'security', 'manager'];

const filtros = {
    from: { type: 'string', format: 'date', description: 'Desde (YYYY-MM-DD)' },
    to: { type: 'string', format: 'date', description: 'Hasta (YYYY-MM-DD)' },
    team_id: { type: 'integer', minimum: 1 },
    course_id: { type: 'integer', minimum: 1 }
};

const reporteDeDesempeno = {
    query: {
        type: 'object',
        properties: {
            ...filtros,
            page: { type: 'integer', minimum: 1, default: 1 },
            page_size: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
        }
    }
};

const exportacion = {
    body: {
        type: 'object',
        properties: { format: { type: 'string', enum: FORMATOS, default: 'csv' }, ...filtros },
        description: 'Tambien se aceptan los mismos campos por query string.'
    }
};

const porExportacion = {
    params: {
        type: 'object',
        required: ['exportId'],
        properties: { exportId: { type: 'string', description: 'Identificador aleatorio de la exportacion' } }
    }
};

const programacion = {
    type: 'object',
    properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        report_type: { type: 'string', enum: TIPOS },
        frequency: { type: 'string', enum: FRECUENCIAS },
        format: { type: 'string', enum: FORMATOS, description: 'organizational solo admite csv' },
        params: { type: 'object', properties: filtros, description: 'Filtros congelados del reporte' },
        subscriber_roles: { type: 'array', minItems: 1, items: { type: 'string', enum: ROLES } },
        is_active: { type: 'boolean' }
    }
};

const crearProgramacion = {
    body: { ...programacion, required: ['name', 'report_type', 'frequency', 'format', 'subscriber_roles'] }
};

const actualizarProgramacion = { params: paramsId('id'), body: { ...programacion, minProperties: 1 } };

const historico = {
    query: {
        type: 'object',
        properties: {
            schedule_id: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
        }
    }
};

const porId = { params: paramsId('id') };

const organizacional = {
    query: {
        type: 'object',
        properties: {
            period: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM. Por defecto, el mes en curso' },
            compare_to: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM. Por defecto, el mes anterior' },
            area_id: { type: 'integer', minimum: 1, description: 'Sin el: consolidado de toda la organizacion' }
        }
    }
};

module.exports = {
    TIPOS,
    FRECUENCIAS,
    FORMATOS,
    reporteDeDesempeno,
    exportacion,
    porExportacion,
    crearProgramacion,
    actualizarProgramacion,
    historico,
    porId,
    organizacional
};
