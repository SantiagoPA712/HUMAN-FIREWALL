/**
 * Constructor de operaciones OpenAPI.
 *
 * Escribir a mano cada operacion en OpenAPI es largo y facil de
 * desalinear: hay que repetir los parametros, el esquema del cuerpo, la
 * seguridad y los errores comunes. Esta funcion los arma a partir de lo que
 * el servicio ya tiene:
 *
 *   - el DTO de controller/dto.js (el mismo objeto que valida la ruta), y
 *   - la politica de acceso de la ruta (publica, autenticada o por roles).
 *
 * Uso, en servicios/<servicio>/contrato/openapi.js:
 *
 *   '/api/courses/{courseId}': {
 *     get: operacion({
 *       resumen: 'Detalle de un curso',
 *       acceso: 'autenticado',
 *       dto: esquemas.porCurso,
 *       respuestas: { 200: { descripcion: 'Curso con sus lecciones', esquema: ref('CursoDetalle') } },
 *       errores: [404]
 *     })
 *   }
 */

const { RESPUESTA_POR_STATUS } = require('./esquemas-comunes');

/** Convierte un esquema de objeto (params/query) en la lista de parameters. */
function parametros(esquema, ubicacion) {
    if (!esquema || !esquema.properties) return [];
    const requeridos = new Set(esquema.required || []);
    return Object.entries(esquema.properties).map(([nombre, schema]) => ({
        name: nombre,
        in: ubicacion,
        required: ubicacion === 'path' ? true : requeridos.has(nombre),
        ...(schema.description ? { description: schema.description } : {}),
        schema
    }));
}

/**
 * @param {object}   o
 * @param {string}   o.resumen
 * @param {string}   [o.descripcion]
 * @param {'publica'|'autenticado'|string[]} o.acceso  roles permitidos si es un arreglo
 * @param {string}   [o.propietario]  parametro de ruta del dueno: el propio usuario
 *                                   tambien puede, ademas de los roles
 * @param {object}   [o.dto]         { body?, params?, query? } (de controller/dto.js)
 * @param {boolean}  [o.validado=true] false si el DTO solo documenta y la
 *                                   validacion la hace el servicio
 * @param {object}   o.respuestas    { status: { descripcion, esquema?, ejemplo?, tipo? } }
 * @param {number[]} [o.errores]     status de error propios de la operacion
 * @param {boolean}  [o.limitada]    tiene limite de solicitudes por IP (429)
 * @param {boolean}  [o.deprecated]
 */
function operacion(o) {
    const op = { summary: o.resumen };
    if (o.descripcion) op.description = o.descripcion;
    if (o.deprecated) op.deprecated = true;

    // Seguridad
    if (o.acceso === 'publica') {
        op.security = [];
    } else {
        op.security = [{ bearerAuth: [] }];
        op['x-roles'] = Array.isArray(o.acceso) ? o.acceso : [];
        if (o.propietario) op['x-propietario'] = o.propietario;
    }

    // Entrada
    const dto = o.dto || {};
    const params = [...parametros(dto.params, 'path'), ...parametros(dto.query, 'query')];
    if (params.length) op.parameters = params;
    if (dto.body) {
        op.requestBody = {
            required: true,
            content: { 'application/json': { schema: dto.body } }
        };
    }
    if (o.dto) op['x-validacion'] = o.validado === false ? 'servicio' : 'middleware';

    // Respuestas
    op.responses = {};
    for (const [status, r] of Object.entries(o.respuestas)) {
        const resp = { description: r.descripcion };
        if (r.esquema || r.tipo) {
            const tipo = r.tipo || 'application/json';
            resp.content = { [tipo]: { schema: r.esquema || { type: 'string', format: 'binary' } } };
            if (r.ejemplo !== undefined) resp.content[tipo].example = r.ejemplo;
        }
        if (r.encabezados) resp.headers = r.encabezados;
        op.responses[status] = resp;
    }

    const errores = new Set(o.errores || []);
    if (dto.body || dto.params || dto.query) errores.add(400);
    if (o.acceso !== 'publica') { errores.add(401); }
    if (Array.isArray(o.acceso) && o.acceso.length) errores.add(403);
    if (o.propietario) { errores.add(400); errores.add(403); }
    if (o.limitada) errores.add(429);
    errores.add(500);

    for (const status of [...errores].sort()) {
        if (op.responses[status]) continue;
        op.responses[status] = { $ref: `#/components/responses/${RESPUESTA_POR_STATUS[status]}` };
    }
    return op;
}

module.exports = { operacion };
