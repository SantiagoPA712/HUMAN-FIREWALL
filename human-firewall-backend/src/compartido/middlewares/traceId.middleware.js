/**
 * ID de correlacion por request (trace_id).
 *
 * HU de logs de auditoria, criterio de aceptacion 3: el detalle de un log
 * muestra "el ID de correlacion (trace_id) si el evento proviene de otro
 * modulo".
 *
 * Cada request recibe un identificador. Todas las filas de data.logs que
 * produzca ese request lo llevan, asi que se pueden unir: "este cambio de rol
 * y esta exportacion salieron de la misma llamada".
 *
 * Si la llamada ya trae un encabezado X-Trace-Id (porque viene de otro
 * modulo o servicio que ya abrio la traza), se respeta en lugar de generar
 * uno nuevo: asi la traza atraviesa los modulos sin cortarse. Se valida el
 * formato para que nadie pueda meter texto arbitrario en el log por un
 * encabezado.
 *
 * El valor vuelve en la respuesta, en el mismo encabezado, para que quien
 * reporte un error pueda dar el trace_id y encontrar sus logs.
 */

const crypto = require('crypto');

const FORMATO_VALIDO = /^[A-Za-z0-9._-]{8,64}$/;

function asignarTraceId(req, res, next) {
    const entrante = typeof req.get === 'function' ? req.get('x-trace-id') : null;

    req.traceId = entrante && FORMATO_VALIDO.test(entrante)
        ? entrante
        : crypto.randomUUID();

    res.setHeader('X-Trace-Id', req.traceId);
    next();
}

module.exports = { asignarTraceId, FORMATO_VALIDO };
