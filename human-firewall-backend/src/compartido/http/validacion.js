/**
 * Validacion de solicitudes con DTO (esquemas JSON Schema).
 *
 * Cada servicio declara en controller/dto.js la forma de lo que acepta: el
 * cuerpo, los parametros de ruta y los de query. El mismo objeto sirve para
 * dos cosas, y esa es la gracia:
 *
 *   1. Este middleware lo usa para rechazar la solicitud ANTES de llegar al
 *      controlador, con un 400 y el detalle por campo.
 *   2. El contrato OpenAPI (contract/openapi.js) lo publica tal cual como
 *      requestBody / parameters.
 *
 * Asi la documentacion no puede quedar desalineada con lo que de verdad se
 * valida: es el mismo objeto.
 *
 * Decisiones:
 *   - No se rechazan campos desconocidos (sin additionalProperties: false):
 *     un cliente viejo que manda un campo de mas no debe romperse.
 *   - El cuerpo NO se convierte de tipo: si un campo es entero y llega "3",
 *     el esquema lo tiene que aceptar explicitamente (ver idEntero). Los
 *     parametros de ruta y de query si se convierten para validarlos, porque
 *     en HTTP siempre llegan como texto; la conversion se hace sobre una
 *     copia y el controlador sigue recibiendo el valor original.
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { ErrorHttp } = require('./errores');

const opciones = { allErrors: true, strict: false };
const ajvCuerpo = addFormats(new Ajv(opciones));
const ajvTexto = addFormats(new Ajv({ ...opciones, coerceTypes: true }));

const cache = new WeakMap();
function compilar(ajv, esquema) {
    let porAjv = cache.get(esquema);
    if (!porAjv) { porAjv = new Map(); cache.set(esquema, porAjv); }
    if (!porAjv.has(ajv)) porAjv.set(ajv, ajv.compile(esquema));
    return porAjv.get(ajv);
}

/** Traduce un error de Ajv a { campo, detalle } en espanol. */
function traducir(e, prefijo) {
    const ruta = e.instancePath.replace(/^\//, '').replace(/\//g, '.');
    const campo = e.keyword === 'required'
        ? [ruta, e.params.missingProperty].filter(Boolean).join('.')
        : ruta || prefijo;

    const p = e.params;
    const detalles = {
        required: 'Es obligatorio.',
        type: `Debe ser de tipo ${[].concat(p.type).map(t => ({ integer: 'entero', string: 'texto', boolean: 'booleano', number: 'numero', array: 'arreglo', object: 'objeto', null: 'nulo' }[t] || t)).join(' o ')}.`,
        minLength: `Debe tener al menos ${p.limit} caracteres.`,
        maxLength: `Debe tener como maximo ${p.limit} caracteres.`,
        minimum: `Debe ser mayor o igual a ${p.limit}.`,
        maximum: `Debe ser menor o igual a ${p.limit}.`,
        minItems: `Debe tener al menos ${p.limit} elemento(s).`,
        maxItems: `Debe tener como maximo ${p.limit} elementos.`,
        enum: `Valor invalido. Validos: ${(p.allowedValues || []).map(v => v === null ? 'null' : v).join(', ')}.`,
        format: `Formato invalido (${p.format}).`,
        pattern: 'Formato invalido.',
        minProperties: 'Debe incluir al menos un campo.'
    };
    return { campo, detalle: e.message && !detalles[e.keyword] ? e.message : detalles[e.keyword] };
}

/** Un error por campo: el primero que reporta Ajv es el mas util. */
function unoPorCampo(errores) {
    const vistos = new Map();
    for (const e of errores) if (!vistos.has(e.campo)) vistos.set(e.campo, e);
    return [...vistos.values()];
}

/**
 * Middleware de validacion.
 *
 * @param {{ body?: object, params?: object, query?: object }} dto
 *        esquemas JSON Schema de cada parte de la solicitud
 */
function validar(dto = {}) {
    const middleware = (req, res, next) => {
        const errores = [];

        if (dto.params) {
            const v = compilar(ajvTexto, dto.params);
            if (!v({ ...req.params })) errores.push(...v.errors.map(e => traducir(e, 'params')));
        }
        if (dto.query) {
            const v = compilar(ajvTexto, dto.query);
            if (!v({ ...req.query })) errores.push(...v.errors.map(e => traducir(e, 'query')));
        }
        if (dto.body) {
            const v = compilar(ajvCuerpo, dto.body);
            const cuerpo = req.body === undefined ? {} : req.body;
            if (!v(cuerpo)) errores.push(...v.errors.map(e => traducir(e, 'body')));
        }

        if (errores.length > 0) return next(ErrorHttp.validacion(unoPorCampo(errores)));
        return next();
    };
    // Las pruebas de contrato leen esto para comprobar que la ruta valida lo
    // mismo que documenta.
    middleware.dto = dto;
    return middleware;
}

// ---------------------------------------------------------------------
// Piezas reutilizables para los esquemas de cada servicio
// ---------------------------------------------------------------------

/** Id numerico positivo. En el cuerpo se acepta tambien como texto ("12"). */
const idEntero = {
    type: ['integer', 'string'],
    minimum: 1,
    pattern: '^[1-9][0-9]*$',
    description: 'Identificador numerico positivo',
    examples: [1]
};

/** Parametro de ruta con un id numerico. */
const paramsId = (nombre = 'id') => ({
    type: 'object',
    required: [nombre],
    properties: { [nombre]: { type: 'integer', minimum: 1, description: `Id numerico (${nombre})` } }
});

/** Fecha ISO 8601: solo fecha (2026-12-01) o fecha y hora con zona. */
const fechaIso = {
    type: 'string',
    anyOf: [{ format: 'date-time' }, { format: 'date' }],
    description: 'Fecha ISO 8601 (YYYY-MM-DD o fecha y hora con zona)',
    examples: ['2026-12-01']
};

module.exports = { validar, idEntero, paramsId, fechaIso };
