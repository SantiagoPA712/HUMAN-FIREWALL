/**
 * Contrato publico (OpenAPI) del servicio de gamificacion.
 * Ver servicios/identidad/contrato/openapi.js para el formato.
 *
 * Las rutas /{userId} las puede consultar el propio usuario, admin o rh
 * (x-propietario: userId). Cualquier otro rol recibe 403 sin que se consulte
 * la base.
 */

const { operacion } = require('../../../compartido/contratos/operacion');
const { ref } = require('../../../compartido/contratos/esquemas-comunes');
const esquemas = require('../api/esquemas');

const fecha = { type: 'string', format: 'date-time' };
const fechaONull = { type: ['string', 'null'], format: 'date-time' };
const propioOGestion = { acceso: ['admin', 'rh'], propietario: 'userId' };

const schemas = {
    PosicionEnRanking: {
        type: 'object',
        required: ['id', 'email', 'total_points', 'level'],
        properties: { id: { type: 'integer' }, email: { type: 'string' }, total_points: { type: 'integer' }, level: { type: 'integer' } }
    },
    InsigniaGanada: {
        type: 'object',
        required: ['name', 'earned_at'],
        properties: {
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            icon_url: { type: ['string', 'null'] },
            earned_at: fecha
        }
    },
    MiEstado: {
        type: 'object',
        required: ['gamification', 'badges'],
        properties: {
            gamification: {
                type: 'object',
                properties: { total_points: { type: 'integer' }, level: { type: 'integer' } }
            },
            badges: { type: 'array', items: ref('InsigniaGanada') }
        }
    },
    ReglaDePuntos: {
        type: 'object',
        required: ['code', 'source_type', 'points_mode', 'points'],
        properties: {
            code: { type: 'string' },
            source_type: { type: 'string' },
            points_mode: { type: 'string', enum: ['fixed', 'by_score'] },
            points: { type: 'integer' },
            allow_repeat: { type: 'boolean' },
            description: { type: ['string', 'null'] }
        }
    },
    MovimientoDePuntos: {
        type: 'object',
        required: ['id', 'source_type', 'points', 'created_at'],
        properties: {
            id: { type: 'integer' },
            source_type: { type: 'string' },
            source_id: { type: ['string', 'null'] },
            points: { type: 'integer' },
            rule_code: { type: ['string', 'null'] },
            created_at: fecha
        }
    },
    HistorialDePuntos: {
        type: 'object',
        required: ['user_id', 'total_points', 'paginacion', 'historial'],
        properties: {
            user_id: { type: 'integer' },
            total_points: { type: 'integer' },
            movimientos: { type: 'integer' },
            ultimo_movimiento: fechaONull,
            paginacion: {
                type: 'object',
                properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total_paginas: { type: 'integer' } }
            },
            historial: { type: 'array', items: ref('MovimientoDePuntos') }
        }
    },
    Recompensa: {
        type: 'object',
        required: ['id', 'name', 'condition_type'],
        properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            icon_url: { type: ['string', 'null'] },
            condition_type: { type: 'string', enum: esquemas.TIPOS_DE_CONDICION },
            condition_params: { type: 'object' },
            is_repeatable: { type: 'boolean' },
            points_required: { type: ['integer', 'null'] },
            is_active: { type: 'boolean' },
            created_at: fecha,
            updated_at: fecha
        }
    },
    RecompensasDeUsuario: {
        type: 'object',
        required: ['user_id', 'obtenidas', 'bloqueadas'],
        properties: {
            user_id: { type: 'integer' },
            total_obtenidas: { type: 'integer' },
            obtenidas: { type: 'array', items: { type: 'object' } },
            bloqueadas: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['reward_id', 'name', 'progreso', 'porcentaje'],
                    properties: {
                        reward_id: { type: 'integer' },
                        name: { type: 'string' },
                        condition_type: { type: 'string' },
                        threshold: { type: 'number' },
                        progreso: { type: 'number' },
                        porcentaje: { type: 'number' }
                    }
                }
            }
        }
    },
    Nivel: {
        type: 'object',
        required: ['level', 'name', 'min_points'],
        properties: {
            level: { type: 'integer' },
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            icon_url: { type: ['string', 'null'] },
            min_points: { type: 'integer' }
        }
    },
    NivelDeUsuario: {
        type: 'object',
        required: ['user_id', 'nivel_actual', 'puntos_actuales', 'porcentaje_avance', 'es_nivel_maximo'],
        properties: {
            user_id: { type: 'integer' },
            nivel_actual: { type: 'integer' },
            nombre: { type: 'string' },
            descripcion: { type: ['string', 'null'] },
            icon_url: { type: ['string', 'null'] },
            nivel_min_puntos: { type: 'integer' },
            puntos_actuales: { type: 'integer' },
            siguiente_nivel: { type: ['integer', 'null'] },
            siguiente_nombre: { type: ['string', 'null'] },
            puntos_para_siguiente: { type: ['integer', 'null'] },
            puntos_faltantes: { type: ['integer', 'null'] },
            porcentaje_avance: { type: 'number', minimum: 0, maximum: 100 },
            es_nivel_maximo: { type: 'boolean' },
            historial: { type: 'array', items: { type: 'object' } }
        }
    },
    ResumenDeDesempeno: {
        type: 'object',
        required: ['user_id', 'resumen', 'areas_de_oportunidad'],
        properties: {
            user_id: { type: 'integer' },
            regla: { type: 'object', properties: { code: { type: 'string' }, umbral: { type: 'number' } } },
            resumen: {
                type: 'object',
                properties: {
                    evaluaciones_realizadas: { type: 'integer' },
                    aprobadas: { type: 'integer' },
                    reprobadas: { type: 'integer' },
                    areas_de_oportunidad: { type: 'integer' },
                    pendientes: { type: 'integer' },
                    promedio_general: { type: ['number', 'null'] }
                }
            },
            areas_de_oportunidad: { type: 'array', items: { type: 'object' } },
            pendientes: { type: 'array', items: { type: 'object' } }
        }
    },
    RecomendacionesPrecalculadas: {
        type: 'object',
        required: ['user_id', 'areas', 'recomendaciones'],
        properties: {
            user_id: { type: 'integer' },
            trigger_event: { type: ['string', 'null'] },
            areas: { type: 'array', items: { type: 'object' } },
            recomendaciones: { type: 'array', items: { type: 'object' } },
            generated_at: fechaONull,
            recien_calculada: { type: 'boolean' }
        }
    },
    InsigniaAsignada: {
        type: 'object',
        required: ['msg'],
        properties: {
            msg: { type: 'string' },
            data: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    reward_id: { type: 'integer' },
                    reward_name: { type: 'string' },
                    earned_at: fecha
                }
            }
        }
    }
};

const usuarioDeRuta = { params: esquemas.porUsuario.params };

const paths = {
    '/api/gamification/leaderboard': {
        get: operacion({
            resumen: 'Ranking (top 10 por puntos)',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Ranking', esquema: { type: 'array', items: ref('PosicionEnRanking') } } }
        })
    },
    '/api/gamification/me': {
        get: operacion({
            resumen: 'Puntos, nivel e insignias del usuario autenticado',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Estado', esquema: ref('MiEstado') } },
            errores: [404]
        })
    },
    '/api/gamification/points/rules': {
        get: operacion({
            resumen: 'Reglas de puntuacion vigentes',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Reglas activas', esquema: { type: 'array', items: ref('ReglaDePuntos') } } }
        })
    },
    '/api/gamification/points/{userId}': {
        get: operacion({
            resumen: 'Historial de puntos de un usuario',
            descripcion: 'La fuente de verdad es el historial inmutable points_ledger.',
            ...propioOGestion,
            dto: esquemas.paginacion,
            respuestas: { 200: { descripcion: 'Total y movimientos paginados', esquema: ref('HistorialDePuntos') } },
            errores: [404]
        })
    },
    '/api/gamification/rewards': {
        get: operacion({
            resumen: 'Catalogo de recompensas activas',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Catalogo', esquema: { type: 'array', items: ref('Recompensa') } } }
        })
    },
    '/api/gamification/rewards/{userId}': {
        get: operacion({
            resumen: 'Recompensas obtenidas y bloqueadas de un usuario (con progreso)',
            ...propioOGestion,
            dto: usuarioDeRuta,
            validado: false,
            respuestas: { 200: { descripcion: 'Galeria de logros', esquema: ref('RecompensasDeUsuario') } },
            errores: [404]
        })
    },
    '/api/gamification/levels': {
        get: operacion({
            resumen: 'Escalera de niveles',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Niveles', esquema: { type: 'array', items: ref('Nivel') } } }
        })
    },
    '/api/gamification/level/{userId}': {
        get: operacion({
            resumen: 'Nivel actual y avance hacia el siguiente',
            ...propioOGestion,
            dto: usuarioDeRuta,
            validado: false,
            respuestas: { 200: { descripcion: 'Nivel', esquema: ref('NivelDeUsuario') } },
            errores: [404]
        })
    },
    '/api/gamification/performance/{userId}': {
        get: operacion({
            resumen: 'Resumen de desempeno y areas de oportunidad (calculo en vivo)',
            ...propioOGestion,
            dto: usuarioDeRuta,
            validado: false,
            respuestas: { 200: { descripcion: 'Desempeno', esquema: ref('ResumenDeDesempeno') } },
            errores: [404]
        })
    },
    '/api/gamification/recommendations/{userId}': {
        get: operacion({
            resumen: 'Recomendaciones de refuerzo (proyeccion precalculada por eventos)',
            descripcion: 'Puede estar unos segundos atras de /performance si el worker no proceso el ultimo evento.',
            ...propioOGestion,
            dto: usuarioDeRuta,
            validado: false,
            respuestas: { 200: { descripcion: 'Recomendaciones', esquema: ref('RecomendacionesPrecalculadas') } },
            errores: [404]
        })
    },
    '/api/gamification/badges': {
        post: operacion({
            resumen: 'Crear una recompensa en el catalogo',
            acceso: ['admin'],
            dto: esquemas.crearInsignia,
            respuestas: { 201: { descripcion: 'Recompensa creada', esquema: ref('Recompensa') } }
        })
    },
    '/api/gamification/badges/assign': {
        post: operacion({
            resumen: 'Asignar una insignia a mano (auditado)',
            descripcion: 'Exige motivo. Queda en audit_log y en data.logs.',
            acceso: ['admin', 'instructor'],
            dto: esquemas.asignarInsignia,
            respuestas: {
                201: { descripcion: 'Insignia asignada', esquema: ref('InsigniaAsignada') },
                200: { descripcion: 'El usuario ya la tenia', esquema: ref('Mensaje') }
            },
            errores: [404]
        })
    }
};

module.exports = { paths, schemas };
