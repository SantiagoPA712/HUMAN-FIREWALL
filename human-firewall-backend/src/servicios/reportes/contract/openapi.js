/**
 * Contrato publico (OpenAPI) del servicio de reportes.
 * Ver servicios/identidad/contract/openapi.js para el formato.
 *
 * En todas las rutas el rol se verifica en el middleware: un 403 sale sin
 * ejecutar ninguna consulta ni persistir nada.
 */

const { operacion } = require('../../../compartido/contratos/operacion');
const { ref } = require('../../../compartido/contratos/esquemas-comunes');
const esquemas = require('../controller/dto');

const fecha = { type: 'string', format: 'date-time' };
const fechaONull = { type: ['string', 'null'], format: 'date-time' };
const paginacion = {
    type: 'object',
    properties: {
        page: { type: 'integer' }, page_size: { type: 'integer' },
        total: { type: 'integer' }, total_paginas: { type: 'integer' }
    }
};
const archivo = (descripcion) => ({
    descripcion,
    tipo: 'application/octet-stream',
    encabezados: { 'Content-Disposition': { schema: { type: 'string' }, description: 'attachment; filename="..."' } }
});

const schemas = {
    OpcionesDeFiltro: {
        type: 'object',
        required: ['equipos', 'cursos'],
        properties: {
            equipos: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
            cursos: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' } } } }
        }
    },
    ReporteDeDesempeno: {
        type: 'object',
        required: ['filtros', 'paginacion', 'vacio', 'resultados'],
        properties: {
            filtros: { type: 'object' },
            paginacion,
            vacio: { type: 'boolean', description: 'true si no hay datos para los filtros (200, no error)' },
            resultados: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['user_id', 'email', 'puntos', 'nivel'],
                    properties: {
                        user_id: { type: 'integer' },
                        email: { type: 'string' },
                        rol: { type: 'string' },
                        team_id: { type: ['integer', 'null'] },
                        equipo: { type: ['string', 'null'] },
                        puntos: { type: 'integer' },
                        movimientos: { type: 'integer' },
                        nivel: { type: 'integer' },
                        nivel_nombre: { type: 'string' },
                        porcentaje_avance: { type: 'number' },
                        insignias: { type: 'integer' },
                        insignias_nombres: { type: 'array', items: { type: 'string' } },
                        ultima_actividad: { type: ['string', 'null'] }
                    }
                }
            }
        }
    },
    ExportacionEncolada: {
        type: 'object',
        required: ['export_id', 'estado'],
        properties: {
            msg: { type: 'string' },
            export_id: { type: 'string' },
            registros: { type: 'integer' },
            estado: { type: 'string', const: 'pending' },
            consultar_en: { type: 'string' }
        }
    },
    EstadoDeExportacion: {
        type: 'object',
        required: ['export_id', 'estado', 'listo'],
        properties: {
            export_id: { type: 'string' },
            format: { type: 'string', enum: esquemas.FORMATOS },
            estado: { type: 'string', enum: ['pending', 'processing', 'ready', 'failed'] },
            registros: { type: ['integer', 'null'] },
            listo: { type: 'boolean' },
            solicitada_en: fecha,
            completada_en: fechaONull
        }
    },
    Programacion: {
        type: 'object',
        required: ['id', 'name', 'report_type', 'frequency', 'format', 'subscriber_roles', 'is_active'],
        properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            report_type: { type: 'string', enum: esquemas.TIPOS },
            frequency: { type: 'string', enum: esquemas.FRECUENCIAS },
            format: { type: 'string', enum: esquemas.FORMATOS },
            params: { type: 'object' },
            subscriber_roles: { type: 'array', items: { type: 'string' } },
            is_active: { type: 'boolean' },
            next_run_at: fechaONull,
            last_run_at: fechaONull,
            created_by: { type: ['integer', 'null'] },
            created_at: fecha,
            updated_at: fecha,
            generados: { type: 'integer' },
            ultimo_exitoso: { type: ['object', 'string', 'null'] }
        }
    },
    PanelDeProgramaciones: {
        type: 'object',
        required: ['programaciones'],
        properties: {
            tipos: { type: 'array', items: { type: 'string' } },
            frecuencias: { type: 'array', items: { type: 'string' } },
            formatos: { type: 'array', items: { type: 'string' } },
            roles: { type: 'array', items: { type: 'string' } },
            programaciones: { type: 'array', items: ref('Programacion') }
        }
    },
    HistoricoDeReportes: {
        type: 'object',
        required: ['total', 'resultados'],
        properties: {
            total: { type: 'integer' },
            resultados: {
                type: 'array',
                items: {
                    type: 'object',
                    description: 'detalle_tecnico solo aparece si quien consulta es admin',
                    properties: {
                        id: { type: 'integer' },
                        schedule_id: { type: 'integer' },
                        schedule_name: { type: 'string' },
                        period: { type: 'string' },
                        status: { type: 'string' },
                        descarga: { type: ['string', 'null'] },
                        detalle_tecnico: { type: ['string', 'null'] }
                    }
                }
            }
        }
    },
    ReporteOrganizacional: {
        type: 'object',
        required: ['period', 'compare_to', 'estado', 'kpis'],
        properties: {
            period: { type: 'string' },
            compare_to: { type: 'string' },
            area: { type: ['object', 'null'] },
            estado: { type: 'string', description: 'pendiente_de_calculo si todavia no hay snapshot del periodo (200, no error)' },
            mensaje: { type: 'string' },
            kpis: { type: 'array', items: { type: 'object' } },
            tendencia: { type: 'array', items: { type: 'object' } },
            areas_disponibles: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
            calculado_en: fechaONull
        }
    },
    AreaInexistente: {
        type: 'object',
        required: ['msg', 'area_id'],
        properties: { msg: { type: 'string' }, codigo: { type: 'string' }, area_id: {} }
    }
};

const soloRH = ['rh', 'admin'];
const destinatarios = ['rh', 'security', 'manager', 'admin'];

const paths = {
    '/api/gamification/reports/filters': {
        get: operacion({
            resumen: 'Equipos y cursos para el panel de filtros',
            acceso: soloRH,
            respuestas: { 200: { descripcion: 'Opciones', esquema: ref('OpcionesDeFiltro') } }
        })
    },
    '/api/gamification/reports/performance': {
        get: operacion({
            resumen: 'Reporte de desempeno por persona',
            descripcion: 'Los filtros se validan antes de consultar: un filtro invalido responde 400 sin tocar la base.',
            acceso: soloRH,
            dto: esquemas.reporteDeDesempeno,
            validado: false,
            respuestas: { 200: { descripcion: 'Reporte paginado', esquema: ref('ReporteDeDesempeno') } }
        })
    },
    '/api/gamification/reports/performance/export': {
        post: operacion({
            resumen: 'Exportar el reporte de desempeno (CSV o PDF)',
            descripcion:
                'Por debajo del umbral de filas devuelve el archivo (200). Por encima, encola la ' +
                'generacion y responde 202 con el export_id para consultar despues.',
            acceso: soloRH,
            dto: esquemas.exportacion,
            validado: false,
            respuestas: {
                200: archivo('Archivo CSV o PDF'),
                202: { descripcion: 'Exportacion encolada', esquema: ref('ExportacionEncolada') }
            }
        })
    },
    '/api/gamification/reports/exports/{exportId}': {
        get: operacion({
            resumen: 'Estado de una exportacion encolada',
            descripcion: 'No incluye los filtros ni quien la pidio: eso es auditoria interna.',
            acceso: soloRH,
            dto: esquemas.porExportacion,
            validado: false,
            respuestas: { 200: { descripcion: 'Estado', esquema: ref('EstadoDeExportacion') } },
            errores: [404]
        })
    },
    '/api/gamification/reports/exports/{exportId}/download': {
        get: operacion({
            resumen: 'Descargar una exportacion ya generada',
            acceso: soloRH,
            dto: esquemas.porExportacion,
            validado: false,
            respuestas: { 200: archivo('Archivo') },
            errores: [404]
        })
    },
    '/api/gamification/reports/schedules': {
        get: operacion({
            resumen: 'Programaciones de reportes automaticos',
            acceso: ['admin'],
            respuestas: { 200: { descripcion: 'Panel', esquema: ref('PanelDeProgramaciones') } }
        }),
        post: operacion({
            resumen: 'Crear una programacion',
            descripcion: 'Un 403 no persiste nada. La programacion se valida completa antes de escribir.',
            acceso: ['admin'],
            dto: esquemas.crearProgramacion,
            validado: false,
            respuestas: { 201: { descripcion: 'Programacion creada', esquema: ref('Programacion') } }
        })
    },
    '/api/gamification/reports/schedules/{id}': {
        patch: operacion({
            resumen: 'Cambiar una programacion',
            acceso: ['admin'],
            dto: esquemas.actualizarProgramacion,
            validado: false,
            respuestas: { 200: { descripcion: 'Programacion actualizada', esquema: ref('Programacion') } },
            errores: [404]
        })
    },
    '/api/gamification/reports/history': {
        get: operacion({
            resumen: 'Historico de reportes generados',
            acceso: destinatarios,
            dto: esquemas.historico,
            validado: false,
            respuestas: { 200: { descripcion: 'Historico', esquema: ref('HistoricoDeReportes') } }
        })
    },
    '/api/gamification/reports/history/{id}/download': {
        get: operacion({
            resumen: 'Descargar un reporte generado',
            acceso: destinatarios,
            dto: esquemas.porId,
            validado: false,
            respuestas: { 200: archivo('Archivo del reporte') },
            errores: [404]
        })
    },
    '/api/gamification/reports/organizational': {
        get: operacion({
            resumen: 'Resultados organizacionales consolidados (gerencia)',
            descripcion: 'Lee snapshots precalculados; nunca agrega en vivo sobre points_ledger.',
            acceso: ['manager', 'admin'],
            dto: esquemas.organizacional,
            validado: false,
            respuestas: {
                200: { descripcion: 'KPIs y tendencia', esquema: ref('ReporteOrganizacional') },
                404: { descripcion: 'El area no existe o esta desactivada', esquema: ref('AreaInexistente') }
            }
        })
    }
};

module.exports = { paths, schemas };
