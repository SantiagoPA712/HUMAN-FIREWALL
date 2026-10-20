/**
 * Esquemas y respuestas que comparten todos los contratos.
 *
 * Es la convencion de formato de la API escrita como contrato: como se ve un
 * error, un error de validacion, una pagina de resultados. Los contratos de
 * cada servicio las referencian con $ref en lugar de repetirlas.
 */

const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` });

const schemas = {
    Error: {
        type: 'object',
        description: 'Formato comun de error. Ver compartido/http/errores.js.',
        required: ['msg'],
        properties: {
            msg: { type: 'string', description: 'Mensaje para la persona que usa la aplicacion' },
            codigo: {
                type: 'string',
                enum: ['VALIDACION', 'NO_AUTENTICADO', 'PROHIBIDO', 'NO_ENCONTRADO', 'CONFLICTO', 'JSON_INVALIDO', 'ERROR_INTERNO'],
                description: 'Codigo estable para que el cliente decida sin leer el texto'
            },
            traceId: { type: 'string', description: 'Solo en 500: identificador para buscar el error en los logs del servidor' }
        },
        examples: [{ msg: 'Curso no encontrado', codigo: 'NO_ENCONTRADO' }]
    },
    ErrorDeValidacion: {
        type: 'object',
        required: ['msg'],
        properties: {
            msg: { type: 'string' },
            codigo: { type: 'string', enum: ['VALIDACION', 'JSON_INVALIDO'] },
            errores: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['campo', 'detalle'],
                    properties: {
                        campo: { type: 'string', description: 'Campo con el problema (body, query o params)' },
                        detalle: { type: 'string' }
                    }
                }
            }
        },
        examples: [{
            msg: 'Parametros invalidos',
            codigo: 'VALIDACION',
            errores: [{ campo: 'title', detalle: 'Es obligatorio.' }]
        }]
    },
    Mensaje: {
        type: 'object',
        required: ['msg'],
        properties: { msg: { type: 'string' } },
        examples: [{ msg: 'Operacion realizada' }]
    },
    Token: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', description: 'JWT con { id, role }. Se manda como Authorization: Bearer <token>' } }
    },
    Paginacion: {
        type: 'object',
        properties: {
            page: { type: 'integer' },
            page_size: { type: 'integer' },
            total: { type: 'integer' },
            total_pages: { type: 'integer' }
        }
    }
};

const conJson = (descripcion, schema) => ({
    description: descripcion,
    content: { 'application/json': { schema } }
});

const responses = {
    ErrorDeValidacion: conJson('Datos invalidos o incompletos', ref('ErrorDeValidacion')),
    NoAutenticado: conJson('Falta el token, o es invalido o vencio', ref('Error')),
    Prohibido: conJson('El token es valido pero el rol no alcanza. Se responde sin consultar la base.', ref('Error')),
    NoEncontrado: conJson('El recurso no existe', ref('Error')),
    Conflicto: conJson('El recurso ya existe o esta en un estado que no lo permite', ref('Error')),
    DemasiadasSolicitudes: conJson('Se supero el limite de solicitudes por IP', ref('Mensaje')),
    ErrorInterno: conJson('Error inesperado. Nunca incluye detalles internos; trae traceId.', ref('Error'))
};

/** Status HTTP -> respuesta comun. */
const RESPUESTA_POR_STATUS = {
    400: 'ErrorDeValidacion',
    401: 'NoAutenticado',
    403: 'Prohibido',
    404: 'NoEncontrado',
    409: 'Conflicto',
    429: 'DemasiadasSolicitudes',
    500: 'ErrorInterno'
};

module.exports = { ref, schemas, responses, RESPUESTA_POR_STATUS, conJson };
