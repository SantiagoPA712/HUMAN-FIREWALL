/**
 * Contrato publico (OpenAPI) del servicio de notificaciones.
 * Ver servicios/identidad/contract/openapi.js para el formato.
 *
 * Ninguna ruta recibe un userId: una notificacion es del dueno y de nadie
 * mas, asi que el id sale siempre del token.
 */

const { operacion } = require('../../../compartido/contratos/operacion');
const { ref } = require('../../../compartido/contratos/esquemas-comunes');
const esquemas = require('../controller/dto');

const fecha = { type: 'string', format: 'date-time' };
const fechaONull = { type: ['string', 'null'], format: 'date-time' };

const schemas = {
    Notificacion: {
        type: 'object',
        required: ['id', 'event_name', 'title', 'created_at'],
        properties: {
            id: { type: 'integer' },
            event_name: { type: 'string' },
            title: { type: 'string' },
            body: { type: ['string', 'null'] },
            payload: { type: ['object', 'null'] },
            email_status: { type: ['string', 'null'] },
            read_at: fechaONull,
            created_at: fecha
        }
    },
    Bandeja: {
        type: 'object',
        required: ['user_id', 'no_leidas', 'notificaciones'],
        properties: {
            user_id: { type: 'integer' },
            no_leidas: { type: 'integer' },
            notificaciones: { type: 'array', items: ref('Notificacion') }
        }
    },
    NotificacionLeida: {
        type: 'object',
        required: ['id', 'read_at'],
        properties: { id: { type: 'integer' }, read_at: fecha }
    },
    CentroDeResultados: {
        type: 'object',
        required: ['user_id', 'no_leidas', 'resultados'],
        properties: {
            user_id: { type: 'integer' },
            no_leidas: { type: 'integer' },
            resultados: { type: 'array', items: { type: 'object' } }
        }
    },
    MarcadasComoLeidas: {
        type: 'object',
        required: ['marcadas'],
        properties: { marcadas: { type: 'integer' }, avisos_marcados_en_bandeja: { type: 'integer' } }
    },
    PreferenciasDeCanal: {
        type: 'object',
        required: ['user_id', 'canales'],
        properties: {
            user_id: { type: 'integer' },
            canales: { type: 'object', properties: { in_app: { type: 'boolean' }, email: { type: 'boolean' } } },
            nota: { type: 'string' }
        }
    },
    CursosCriticos: {
        type: 'object',
        required: ['total', 'criticos', 'cursos'],
        properties: {
            total: { type: 'integer' },
            criticos: { type: 'integer' },
            cursos: { type: 'array', items: ref('CursoConCriticidad') }
        }
    },
    CursoConCriticidad: {
        type: 'object',
        required: ['id', 'title', 'is_critical'],
        properties: { id: { type: 'integer' }, title: { type: 'string' }, is_critical: { type: 'boolean' } }
    },
    PreferenciasDeCorreo: {
        type: 'object',
        required: ['user_id', 'idioma_efectivo', 'tipos'],
        properties: {
            user_id: { type: 'integer' },
            idioma: { type: ['string', 'null'] },
            idioma_efectivo: { type: 'string' },
            idioma_por_defecto: { type: 'string' },
            canal_email: { type: 'boolean' },
            tipos: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['tipo', 'critico', 'habilitado'],
                    properties: {
                        tipo: { type: 'string' },
                        descripcion: { type: 'string' },
                        critico: { type: 'boolean' },
                        habilitado: { type: 'boolean' }
                    }
                }
            }
        }
    },
    EstadoDeColaDeCorreo: {
        type: 'object',
        required: ['por_estado', 'ultimos_con_problemas'],
        properties: {
            por_estado: { type: 'object', additionalProperties: { type: 'integer' } },
            ultimos_con_problemas: { type: 'array', items: { type: 'object' } }
        }
    },
    EstadoDelBus: {
        type: 'object',
        required: ['por_estado', 'suscriptores'],
        properties: {
            por_estado: { type: 'object', additionalProperties: { type: 'integer' } },
            suscriptores: { type: 'object', additionalProperties: { type: 'integer' }, description: 'evento -> cantidad de handlers' },
            ultimos_fallidos: { type: 'array', items: { type: 'object' } }
        }
    }
};

const paths = {
    '/api/notifications': {
        get: operacion({
            resumen: 'Bandeja de avisos del usuario autenticado',
            acceso: 'autenticado',
            dto: esquemas.bandeja,
            validado: false,
            respuestas: { 200: { descripcion: 'Avisos, del mas reciente al mas viejo', esquema: ref('Bandeja') } }
        })
    },
    '/api/notifications/{id}/leida': {
        patch: operacion({
            resumen: 'Marcar un aviso como leido',
            descripcion: '404 si no existe, ya estaba leido o es de otro usuario (no se distinguen a proposito).',
            acceso: 'autenticado',
            dto: esquemas.porId,
            validado: false,
            respuestas: { 200: { descripcion: 'Aviso marcado', esquema: ref('NotificacionLeida') } },
            errores: [404]
        })
    },
    '/api/notifications/leidas': {
        patch: operacion({
            resumen: 'Marcar todos los resultados como leidos',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Cantidad marcada', esquema: ref('MarcadasComoLeidas') } }
        })
    },
    '/api/notifications/resultados': {
        get: operacion({
            resumen: 'Centro de resultados de evaluaciones, simulaciones y cursos',
            acceso: 'autenticado',
            dto: esquemas.bandeja,
            validado: false,
            respuestas: { 200: { descripcion: 'Resultados notificados', esquema: ref('CentroDeResultados') } }
        })
    },
    '/api/notifications/preferencias': {
        get: operacion({
            resumen: 'Canales habilitados (in-app y correo)',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Preferencias', esquema: ref('PreferenciasDeCanal') } }
        }),
        patch: operacion({
            resumen: 'Cambiar los canales habilitados',
            acceso: 'autenticado',
            dto: esquemas.preferenciasDeCanal,
            validado: false,
            respuestas: { 200: { descripcion: 'Preferencias actualizadas', esquema: ref('PreferenciasDeCanal') } }
        })
    },
    '/api/notifications/cursos-criticos': {
        get: operacion({
            resumen: 'Cursos con su marca de critico',
            descripcion: 'Los resultados de un curso critico tambien se le avisan a RH del equipo.',
            acceso: ['rh', 'admin'],
            respuestas: { 200: { descripcion: 'Cursos', esquema: ref('CursosCriticos') } }
        })
    },
    '/api/notifications/cursos-criticos/{courseId}': {
        patch: operacion({
            resumen: 'Marcar o desmarcar un curso como critico',
            descripcion: 'La marca vive en el servicio de cursos; este endpoint la cambia por su contrato.',
            acceso: ['rh', 'admin'],
            dto: esquemas.cursoCritico,
            validado: false,
            respuestas: { 200: { descripcion: 'Curso actualizado', esquema: ref('CursoConCriticidad') } },
            errores: [404]
        })
    },
    '/api/notifications/correo/preferencias': {
        get: operacion({
            resumen: 'Tipos de correo que recibe el usuario e idioma',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Preferencias de correo', esquema: ref('PreferenciasDeCorreo') } }
        }),
        patch: operacion({
            resumen: 'Activar o desactivar tipos de correo',
            descripcion: 'Los tipos criticos (seguridad) no se pueden desactivar: responde 400.',
            acceso: 'autenticado',
            dto: esquemas.preferenciasDeCorreo,
            validado: false,
            respuestas: { 200: { descripcion: 'Preferencias actualizadas', esquema: ref('PreferenciasDeCorreo') } }
        })
    },
    '/api/notifications/correo/estado': {
        get: operacion({
            resumen: 'Diagnostico de la cola de correo',
            acceso: ['admin'],
            respuestas: { 200: { descripcion: 'Correos por estado y ultimos con problemas', esquema: ref('EstadoDeColaDeCorreo') } }
        })
    },
    '/api/notifications/eventos/estado': {
        get: operacion({
            resumen: 'Diagnostico del bus de eventos',
            descripcion: 'Eventos por estado en event_outbox, suscriptores por evento y ultimos fallidos.',
            acceso: ['admin'],
            respuestas: { 200: { descripcion: 'Estado del bus', esquema: ref('EstadoDelBus') } }
        })
    }
};

module.exports = { paths, schemas };
