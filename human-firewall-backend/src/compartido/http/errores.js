/**
 * Formato comun de errores de la API.
 *
 * Toda respuesta de error de cualquier servicio tiene esta forma:
 *
 *   {
 *     "msg":     "Texto para la persona que usa la aplicacion",
 *     "codigo":  "VALIDACION",                       (opcional, estable)
 *     "errores": [{ "campo": "email", "detalle": "..." }],  (solo en 400)
 *     "traceId": "3f6c..."                           (solo en 500)
 *   }
 *
 * `msg` se conserva con ese nombre porque el frontend ya lo lee en todas las
 * pantallas (err.response.data.msg). `errores` es el formato que ya usaban
 * logs, reportes, seguridad y usuarios; ahora es el de todos.
 *
 * Regla de seguridad: un 500 NUNCA devuelve error.message. Antes 68
 * controladores respondian { msg: error.message }, y eso dejaba salir el
 * texto crudo de PostgreSQL ("duplicate key value violates unique constraint
 * users_email_key", nombres de tablas y columnas, etc.). Ahora el detalle se
 * escribe en el log del servidor con el traceId, y la respuesta solo lleva
 * el traceId para poder encontrarlo.
 */

const CODIGOS = {
    VALIDACION: 'VALIDACION',
    NO_AUTENTICADO: 'NO_AUTENTICADO',
    PROHIBIDO: 'PROHIBIDO',
    NO_ENCONTRADO: 'NO_ENCONTRADO',
    CONFLICTO: 'CONFLICTO',
    JSON_INVALIDO: 'JSON_INVALIDO',
    ERROR_INTERNO: 'ERROR_INTERNO'
};

/**
 * Error con status HTTP. Lo lanzan las capas de aplicacion y dominio cuando
 * la falla es del cliente (dato invalido, recurso inexistente, conflicto).
 * Cualquier otro error se trata como 500.
 */
class ErrorHttp extends Error {
    /**
     * @param {number} status
     * @param {string} msg
     * @param {object} [extra]  campos adicionales del cuerpo (codigo, errores, ...)
     */
    constructor(status, msg, extra = {}) {
        super(msg);
        this.name = 'ErrorHttp';
        this.status = status;
        this.extra = extra;
    }

    static validacion(errores, msg = 'Parametros invalidos') {
        return new ErrorHttp(400, msg, { codigo: CODIGOS.VALIDACION, errores });
    }

    static noEncontrado(msg, extra = {}) {
        return new ErrorHttp(404, msg, { codigo: CODIGOS.NO_ENCONTRADO, ...extra });
    }

    static conflicto(msg, extra = {}) {
        return new ErrorHttp(409, msg, { codigo: CODIGOS.CONFLICTO, ...extra });
    }
}

/**
 * Convierte cualquier error en { status, cuerpo }.
 *
 * Reconoce, ademas de ErrorHttp, las convenciones que ya usaban los servicios
 * antes de esta HU, para no tener que reescribirlos:
 *   - { codigo: <status>, cuerpo }      invitaciones
 *   - { codigo: 400|404, errores, ... } preferencias y reporte organizacional
 *   - { campo }                         validaciones de reportes y seguridad
 *   - error de parseo de express.json() JSON mal formado
 */
function traducirError(error) {
    if (error instanceof ErrorHttp) {
        return { status: error.status, cuerpo: { msg: error.message, ...error.extra } };
    }

    if (error && Number.isInteger(error.codigo) && error.cuerpo) {
        return { status: error.codigo, cuerpo: error.cuerpo };
    }

    if (error && error.codigo === 400) {
        if (error.errores) {
            return {
                status: 400,
                cuerpo: { msg: error.message, codigo: CODIGOS.VALIDACION, errores: error.errores }
            };
        }
        if (error.campo) {
            return {
                status: 400,
                cuerpo: {
                    msg: 'Parametros invalidos',
                    codigo: CODIGOS.VALIDACION,
                    errores: [{ campo: error.campo, detalle: error.message }]
                }
            };
        }
        return { status: 400, cuerpo: { msg: error.message, codigo: CODIGOS.VALIDACION } };
    }

    if (error && error.codigo === 404) {
        const { codigo, message, stack, ...resto } = error;
        return { status: 404, cuerpo: { msg: error.message, codigo: CODIGOS.NO_ENCONTRADO, ...resto } };
    }

    if (error && error.campo) {
        return {
            status: 400,
            cuerpo: {
                msg: 'Parametros invalidos',
                codigo: CODIGOS.VALIDACION,
                errores: [{ campo: error.campo, detalle: error.message }]
            }
        };
    }

    // express.json() con un cuerpo que no es JSON valido.
    if (error && error.type === 'entity.parse.failed') {
        return {
            status: 400,
            cuerpo: { msg: 'El cuerpo de la solicitud no es un JSON valido', codigo: CODIGOS.JSON_INVALIDO }
        };
    }

    // Valor con formato invalido para la columna (por ejemplo "abc" en un id
    // numerico). Es un error del cliente, no del servidor.
    if (error && error.code === '22P02') {
        return {
            status: 400,
            cuerpo: { msg: 'Algun parametro tiene un formato invalido', codigo: CODIGOS.VALIDACION }
        };
    }

    return null;
}

/**
 * Responde un error con el formato comun. Se usa en los catch de los
 * controladores en lugar de res.status(500).json({ msg: error.message }).
 *
 * Funciona con el res real de Express y con los stubs de las pruebas (solo
 * necesita status() y json()).
 */
function responderError(req, res, error) {
    const traducido = traducirError(error);
    if (traducido) return res.status(traducido.status).json(traducido.cuerpo);

    const traceId = req && req.traceId ? req.traceId : undefined;
    console.error(`[error] ${req?.method || ''} ${req?.originalUrl || ''} traceId=${traceId || '-'}`, error);

    return res.status(500).json({
        msg: 'Error interno del servidor',
        codigo: CODIGOS.ERROR_INTERNO,
        ...(traceId ? { traceId } : {})
    });
}

/**
 * Middleware de errores de Express (el ultimo de la cadena). Atrapa lo que
 * ningun controlador atrapo: excepciones de middlewares, JSON mal formado y
 * promesas rechazadas (Express 5 las reenvia aca).
 */
// eslint-disable-next-line no-unused-vars
function manejadorDeErrores(error, req, res, next) {
    if (res.headersSent) return next(error);
    return responderError(req, res, error);
}

module.exports = { CODIGOS, ErrorHttp, traducirError, responderError, manejadorDeErrores };
