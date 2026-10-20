/**
 * Contrato publico (OpenAPI) del servicio de seguridad.
 * Ver servicios/identidad/contrato/openapi.js para el formato.
 *
 * Todas las rutas verifican el rol en el middleware: un 401/403 sale sin
 * ejecutar ninguna consulta. data.logs es inmutable por la API: cualquier
 * metodo distinto de GET sobre /api/logs responde 405.
 */

const { operacion } = require('../../../compartido/contratos/operacion');
const { ref } = require('../../../compartido/contratos/esquemas-comunes');
const esquemas = require('../api/esquemas');

const fecha = { type: 'string', format: 'date-time' };
const fechaONull = { type: ['string', 'null'], format: 'date-time' };
const paginacion = {
    type: 'object',
    properties: {
        page: { type: 'integer' }, page_size: { type: 'integer' },
        total: { type: 'integer' }, total_paginas: { type: 'integer' }
    }
};

const schemas = {
    ReglaDeAnomalia: {
        type: 'object',
        required: ['code', 'rule_type', 'window_minutes', 'max_points', 'severity'],
        properties: {
            code: { type: 'string' },
            description: { type: ['string', 'null'] },
            rule_type: { type: 'string' },
            window_minutes: { type: 'integer' },
            max_points: { type: 'integer' },
            severity: { type: 'string', enum: esquemas.SEVERIDADES }
        }
    },
    ListaDeAuditoria: {
        type: 'object',
        required: ['paginacion', 'resultados'],
        properties: { paginacion, resultados: { type: 'array', items: { type: 'object' } } }
    },
    ListaDeAnomalias: {
        type: 'object',
        required: ['paginacion', 'resumen', 'resultados'],
        properties: {
            paginacion,
            resumen: {
                type: 'object',
                properties: {
                    total: { type: 'integer' }, pendientes: { type: 'integer' },
                    revisadas: { type: 'integer' }, descartadas: { type: 'integer' },
                    por_severidad: { type: 'object' }
                }
            },
            resultados: { type: 'array', items: { type: 'object' } }
        }
    },
    Anomalia: {
        type: 'object',
        required: ['id', 'user_id', 'status', 'severity'],
        properties: {
            id: { type: 'integer' },
            user_id: { type: 'integer' },
            rule_triggered: { type: 'string' },
            severity: { type: 'string', enum: esquemas.SEVERIDADES },
            status: { type: 'string', enum: esquemas.ESTADOS_ANOMALIA },
            evidence: { type: 'object' },
            detected_at: fecha
        }
    },
    CambioDeEstado: {
        type: 'object',
        required: ['msg', 'anomalia'],
        properties: { msg: { type: 'string' }, anomalia: { type: 'object' } }
    },
    AjusteAplicado: {
        type: 'object',
        required: ['msg', 'aplicado', 'auditoria', 'estado_previo', 'estado_nuevo'],
        properties: {
            msg: { type: 'string' },
            aplicado: { type: 'object', description: 'Movimiento o recompensa registrada por gamificacion' },
            auditoria: { type: 'object', description: 'Fila de audit_log' },
            estado_previo: ref('FotoDeUsuario'),
            estado_nuevo: ref('FotoDeUsuario')
        }
    },
    FotoDeUsuario: {
        type: 'object',
        properties: {
            puntos: { type: 'integer' }, nivel: { type: 'integer' },
            nivel_nombre: { type: 'string' }, insignias: { type: 'integer' }
        }
    },
    Log: {
        type: 'object',
        required: ['id', 'occurred_at', 'action_type', 'module', 'resource_type'],
        description: 'El listado trae un resumen de cada fila; el detalle (GET /api/logs/{id}) trae todos los campos.',
        properties: {
            id: { type: 'integer' },
            log_uid: { type: 'string' },
            occurred_at: fecha,
            recorded_at: fecha,
            user_id: { type: ['integer', 'null'] },
            actor_type: { type: 'string', enum: ['user', 'system'] },
            actor_email: { type: ['string', 'null'] },
            action_type: { type: 'string' },
            module: { type: 'string' },
            resource_type: { type: 'string' },
            resource_id: { type: ['string', 'null'] },
            old_value: { type: ['object', 'null'], description: 'Valores sensibles como [REDACTED]' },
            new_value: { type: ['object', 'null'], description: 'Valores sensibles como [REDACTED]' },
            ip_address: { type: ['string', 'null'] },
            trace_id: { type: ['string', 'null'] }
        }
    },
    ListaDeLogs: {
        type: 'object',
        required: ['paginacion', 'orden', 'resultados'],
        properties: {
            paginacion,
            orden: { type: 'string', enum: ['asc', 'desc'] },
            resultados: { type: 'array', items: ref('Log') }
        }
    },
    OpcionesDeLogs: {
        type: 'object',
        required: ['modulos', 'acciones', 'usuarios'],
        properties: {
            modulos: { type: 'array', items: { type: 'string' } },
            acciones: { type: 'array', items: { type: 'string' } },
            usuarios: { type: 'array', items: { type: 'object' } },
            tamano_pagina: { type: 'integer' },
            tamano_pagina_maximo: { type: 'integer' }
        }
    }
};

const soloSeguridad = ['security', 'admin'];

const paths = {
    '/api/gamification/security/rules': {
        get: operacion({
            resumen: 'Umbrales vigentes de deteccion de anomalias',
            acceso: soloSeguridad,
            respuestas: { 200: { descripcion: 'Reglas', esquema: { type: 'array', items: ref('ReglaDeAnomalia') } } }
        })
    },
    '/api/gamification/security/audit': {
        get: operacion({
            resumen: 'Auditoria de ajustes manuales',
            acceso: soloSeguridad,
            dto: esquemas.listarAuditoria,
            validado: false,
            respuestas: { 200: { descripcion: 'Ajustes paginados', esquema: ref('ListaDeAuditoria') } }
        })
    },
    '/api/gamification/security/anomalies': {
        get: operacion({
            resumen: 'Anomalias detectadas',
            acceso: soloSeguridad,
            dto: esquemas.listarAnomalias,
            validado: false,
            respuestas: { 200: { descripcion: 'Anomalias paginadas con resumen', esquema: ref('ListaDeAnomalias') } }
        })
    },
    '/api/gamification/security/anomalies/{id}': {
        get: operacion({
            resumen: 'Detalle de una anomalia con la linea de tiempo del usuario',
            acceso: soloSeguridad,
            dto: esquemas.porId,
            respuestas: { 200: { descripcion: 'Anomalia', esquema: ref('Anomalia') } },
            errores: [404]
        })
    },
    '/api/gamification/security/anomalies/{id}/status': {
        patch: operacion({
            resumen: 'Cambiar el estado de una anomalia',
            descripcion: 'Deja traza de quien lo cambio y cuando, sin sobrescribir el estado anterior.',
            acceso: soloSeguridad,
            dto: esquemas.cambiarEstado,
            respuestas: { 200: { descripcion: 'Estado actualizado', esquema: ref('CambioDeEstado') } },
            errores: [404]
        })
    },
    '/api/gamification/users/{id}/adjust': {
        patch: operacion({
            resumen: 'Ajuste manual de puntos, nivel o insignia (auditado)',
            descripcion:
                'Solo admin: seguridad audita los ajustes, no los ejecuta. Sin motivo no se ejecuta (400). ' +
                'El ajuste lo aplica gamificacion por su contrato y queda en audit_log y data.logs.',
            acceso: ['admin'],
            dto: esquemas.ajustarUsuario,
            respuestas: { 200: { descripcion: 'Ajuste aplicado', esquema: ref('AjusteAplicado') } },
            errores: [404]
        })
    },
    '/api/logs': {
        get: operacion({
            resumen: 'Registro de acciones criticas (data.logs)',
            descripcion: 'Sin resultados responde 200 con lista vacia. POST/PUT/PATCH/DELETE responden 405: los logs son inmutables.',
            acceso: ['admin'],
            dto: esquemas.filtrosDeLogs,
            validado: false,
            respuestas: { 200: { descripcion: 'Logs paginados', esquema: ref('ListaDeLogs') } }
        })
    },
    '/api/logs/filtros': {
        get: operacion({
            resumen: 'Opciones para los filtros del registro',
            acceso: ['admin'],
            respuestas: { 200: { descripcion: 'Modulos, acciones y usuarios con acciones', esquema: ref('OpcionesDeLogs') } }
        })
    },
    '/api/logs/export': {
        get: operacion({
            resumen: 'Exportar el registro filtrado a CSV',
            descripcion: 'Mismos filtros que GET /api/logs. La exportacion queda registrada como accion critica.',
            acceso: ['admin'],
            dto: esquemas.filtrosDeLogs,
            validado: false,
            respuestas: {
                200: {
                    descripcion: 'Archivo CSV',
                    tipo: 'text/csv',
                    esquema: { type: 'string' },
                    encabezados: { 'X-Total-Rows': { schema: { type: 'integer' }, description: 'Filas exportadas' } }
                }
            }
        })
    },
    '/api/logs/{id}': {
        get: operacion({
            resumen: 'Detalle de un log: valores anterior y nuevo, IP y trace_id',
            acceso: ['admin'],
            dto: esquemas.porId,
            validado: false,
            respuestas: { 200: { descripcion: 'Log', esquema: ref('Log') } },
            errores: [404]
        })
    }
};

module.exports = { paths, schemas };
