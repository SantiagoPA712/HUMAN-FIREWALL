/**
 * HU: arquitectura de microservicios por capas y contratos de API.
 *
 * Pruebas UNITARIAS de la logica que quedo aislada en su capa con esta HU.
 * Son funciones puras o casi: no necesitan base de datos ni servidor, que es
 * justamente lo que se gana al sacar las reglas de los controladores.
 *
 *   - evaluaciones/dominio/puntaje.js   reglas de puntaje
 *   - identidad/dominio/usuario.js      politica de contrasena y catalogos
 *   - compartido/http/errores.js        formato comun de errores
 *   - compartido/http/validacion.js     validacion por DTO
 *   - compartido/contratos/operacion.js constructor de operaciones OpenAPI
 */

import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';

const DIR = fileURLToPath(new URL('../', import.meta.url));
const require_ = createRequire(`${DIR}src/server.js`);

let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// =====================================================================
console.log('--- DOMINIO DE EVALUACIONES: PUNTAJE ---');
// =====================================================================

const puntaje = require_('./servicios/evaluaciones/dominio/puntaje');

// Dos pasos: el 1 con opciones de 10 (correcta) y 0; el 2 con 20 (correcta) y 5.
const opciones = [
    { id: 1, step_id: 1, is_correct: true, points_awarded: 10 },
    { id: 2, step_id: 1, is_correct: false, points_awarded: 0 },
    { id: 3, step_id: 2, is_correct: true, points_awarded: 20 },
    { id: 4, step_id: 2, is_correct: false, points_awarded: 5 }
];

const perfecto = puntaje.calcularResultadoSimulacion(opciones, [1, 3]);
check('todo correcto: score 100 y aprobada', perfecto.score === 100 && perfecto.aprobada && perfecto.aciertos === 2);
check('el puntaje maximo es la mejor opcion de cada paso', perfecto.puntajeMaximo === 30 && perfecto.pasos === 2);

const parcial = puntaje.calcularResultadoSimulacion(opciones, [2, 3]);
check('20 de 30 puntos: score 67, aprueba (>= 60)', parcial.score === 67 && parcial.aprobada === true);

const flojo = puntaje.calcularResultadoSimulacion(opciones, [1, 4]);
check('15 de 30 puntos: score 50, reprueba', flojo.score === 50 && flojo.aprobada === false);

check('acepta los ids como texto (vienen del JSON del cliente)',
    puntaje.calcularResultadoSimulacion(opciones, ['1', '3']).score === 100);

const ajena = lanza(() => puntaje.calcularResultadoSimulacion(opciones, [1, 99]));
check('una opcion de otra simulacion se rechaza', ajena instanceof puntaje.ReglaDeEvaluacion && /99/.test(ajena.message));

const vacia = lanza(() => puntaje.calcularResultadoSimulacion([], [1]));
check('una simulacion sin opciones se rechaza', vacia instanceof puntaje.ReglaDeEvaluacion);

const sinPuntos = [
    { id: 1, step_id: 1, is_correct: true, points_awarded: 0 },
    { id: 2, step_id: 2, is_correct: false, points_awarded: 0 }
];
const porAciertos = puntaje.calcularResultadoSimulacion(sinPuntos, [1, 2]);
check('si ninguna opcion da puntos, el score sale de los aciertos (y no es NaN)', porAciertos.score === 50);

check('desafio sin passed: se asume aprobado con 100 (cliente viejo)',
    JSON.stringify(puntaje.normalizarResultadoDesafio({})) === JSON.stringify({ aprobado: true, puntaje: 100 }));
check('desafio reprobado sin score: 0',
    puntaje.normalizarResultadoDesafio({ passed: false }).puntaje === 0);
check('el score del cliente se acota a 0..100',
    puntaje.normalizarResultadoDesafio({ passed: true, score: 250 }).puntaje === 100 &&
    puntaje.normalizarResultadoDesafio({ passed: true, score: -5 }).puntaje === 0);
check('un score que no es entero se ignora', puntaje.normalizarResultadoDesafio({ passed: true, score: '90' }).puntaje === 100);

// =====================================================================
console.log('\n--- DOMINIO DE IDENTIDAD ---');
// =====================================================================

const usuario = require_('./servicios/identidad/dominio/usuario');
check('contrasena valida: 8+, mayuscula y numero', usuario.cumplePolitica('Segura123'));
check('sin mayuscula no cumple', !usuario.cumplePolitica('segura123'));
check('sin numero no cumple', !usuario.cumplePolitica('SeguraSegura'));
check('corta no cumple', !usuario.cumplePolitica('Seg1'));
check('un valor que no es texto no cumple (y no revienta)', !usuario.cumplePolitica(undefined) && !usuario.cumplePolitica(12345678));
check('los roles son los del CHECK de la base', usuario.ROLES.length === 6 && usuario.ROLES.includes('manager'));

// =====================================================================
console.log('\n--- FORMATO COMUN DE ERRORES ---');
// =====================================================================

const { ErrorHttp, traducirError, responderError } = require_('./compartido/http/errores');

const resStub = () => {
    const r = { estado: null, cuerpo: null };
    r.status = (c) => { r.estado = c; return r; };
    r.json = (b) => { r.cuerpo = b; return r; };
    return r;
};

const t404 = traducirError(ErrorHttp.noEncontrado('Curso no encontrado'));
check('ErrorHttp.noEncontrado -> 404 con codigo', t404.status === 404 && t404.cuerpo.codigo === 'NO_ENCONTRADO' && t404.cuerpo.msg === 'Curso no encontrado');

const t400 = traducirError(ErrorHttp.validacion([{ campo: 'title', detalle: 'Es obligatorio.' }]));
check('ErrorHttp.validacion -> 400 con errores por campo', t400.status === 400 && t400.cuerpo.errores[0].campo === 'title');

const conCuerpo = traducirError(Object.assign(new Error('x'), { codigo: 410, cuerpo: { msg: 'vencida', motivo: 'expirada' } }));
check('reconoce la convencion { codigo, cuerpo } de invitaciones', conCuerpo.status === 410 && conCuerpo.cuerpo.motivo === 'expirada');

const conCampo = traducirError(Object.assign(new Error('Fecha invalida'), { campo: 'from' }));
check('reconoce la convencion { campo } de reportes y seguridad', conCampo.status === 400 && conCampo.cuerpo.errores[0].campo === 'from');

const conArea = traducirError(Object.assign(new Error('No existe el area 9'), { codigo: 404, area_id: 9 }));
check('un 404 de servicio conserva sus campos extra (area_id)', conArea.status === 404 && conArea.cuerpo.area_id === 9);

check('JSON mal formado -> 400 JSON_INVALIDO', traducirError({ type: 'entity.parse.failed' })?.cuerpo.codigo === 'JSON_INVALIDO');
check('texto invalido para un entero de la base (22P02) -> 400', traducirError({ code: '22P02' })?.status === 400);
const unico = traducirError({ code: '23505', message: 'duplicate key value violates unique constraint "users_email_key"' });
check('unicidad violada (23505) -> 409 sin el nombre del indice', unico?.status === 409 && !JSON.stringify(unico.cuerpo).includes('users_email_key'));
check('cualquier otro error no se traduce (sera 500)', traducirError(new Error('boom')) === null);

const errorOriginal = console.error;
console.error = () => {};
const r500 = resStub();
responderError({ traceId: 'traza-unitaria', method: 'GET', originalUrl: '/x' }, r500,
    new Error('duplicate key value violates unique constraint "users_email_key"'));
console.error = errorOriginal;
check('un 500 responde un mensaje generico', r500.estado === 500 && r500.cuerpo.msg === 'Error interno del servidor');
check('sin el texto interno del error', !JSON.stringify(r500.cuerpo).includes('users_email_key'));
check('con el traceId para buscarlo en el log', r500.cuerpo.traceId === 'traza-unitaria');

const sinReq = resStub();
console.error = () => {};
responderError(undefined, sinReq, new Error('x'));
console.error = errorOriginal;
check('funciona aunque no haya req (pruebas que llaman al controlador directo)', sinReq.estado === 500);

// =====================================================================
console.log('\n--- VALIDACION POR DTO ---');
// =====================================================================

const { validar, idEntero, paramsId } = require_('./compartido/http/validacion');

const dto = {
    params: paramsId('courseId'),
    body: {
        type: 'object',
        required: ['title', 'user_id'],
        properties: { title: { type: 'string', minLength: 1 }, user_id: idEntero, nivel: { type: 'string', enum: ['a', 'b'] } }
    }
};
const middleware = validar(dto);
const correr = (req) => { let recibido = 'no-llamado'; middleware(req, null, (e) => { recibido = e; }); return recibido; };

check('una solicitud valida pasa (next sin error)', correr({ params: { courseId: '5' }, body: { title: 'x', user_id: 3 } }) === undefined);
check('el id en el cuerpo se acepta tambien como texto', correr({ params: { courseId: '5' }, body: { title: 'x', user_id: '3' } }) === undefined);

const faltante = correr({ params: { courseId: '5' }, body: { user_id: 3 } });
check('campo obligatorio ausente -> ErrorHttp 400 con el campo', faltante instanceof ErrorHttp && faltante.status === 400 &&
    faltante.extra.errores.some(e => e.campo === 'title' && e.detalle === 'Es obligatorio.'));

const variosErrores = correr({ params: { courseId: 'abc' }, body: { title: '', user_id: 'tres', nivel: 'z' } });
const campos = variosErrores.extra.errores.map(e => e.campo).sort();
check('reporta todos los campos con problema, uno por campo', JSON.stringify(campos) === JSON.stringify(['courseId', 'nivel', 'title', 'user_id']),
    JSON.stringify(variosErrores.extra.errores));
check('los mensajes estan en espanol', variosErrores.extra.errores.find(e => e.campo === 'nivel').detalle.startsWith('Valor invalido. Validos: a, b'));

check('un cuerpo vacio se valida como objeto vacio (no revienta)', correr({ params: { courseId: '1' } }) instanceof ErrorHttp);
check('los campos desconocidos no se rechazan (compatibilidad con clientes viejos)',
    correr({ params: { courseId: '1' }, body: { title: 'x', user_id: 1, extra: true } }) === undefined);

const req = { params: { courseId: '7' }, body: { title: 'x', user_id: '3' } };
correr(req);
check('la validacion no modifica lo que recibe el controlador', req.params.courseId === '7' && req.body.user_id === '3');
check('el middleware expone su DTO (lo leen las pruebas de contrato)', middleware.dto === dto);

// =====================================================================
console.log('\n--- CONSTRUCTOR DE OPERACIONES OPENAPI ---');
// =====================================================================

const { operacion } = require_('./compartido/contratos/operacion');

const publica = operacion({ resumen: 'x', acceso: 'publica', respuestas: { 200: { descripcion: 'ok' } } });
check('publica: security vacio y sin 401', Array.isArray(publica.security) && publica.security.length === 0 && !publica.responses['401']);

const conRoles = operacion({ resumen: 'x', acceso: ['admin'], dto, respuestas: { 201: { descripcion: 'ok' } }, errores: [404] });
check('con roles: bearer, x-roles, 401 y 403', conRoles.security[0].bearerAuth && conRoles['x-roles'][0] === 'admin' &&
    conRoles.responses['401'] && conRoles.responses['403']);
check('con DTO: 400, parametros de ruta y cuerpo (el mismo objeto)',
    conRoles.responses['400'] && conRoles.parameters[0].name === 'courseId' && conRoles.parameters[0].in === 'path' &&
    conRoles.requestBody.content['application/json'].schema === dto.body);
check('agrega los errores pedidos y siempre el 500', conRoles.responses['404'] && conRoles.responses['500']);

const propietario = operacion({ resumen: 'x', acceso: ['admin', 'rh'], propietario: 'userId', respuestas: { 200: { descripcion: 'ok' } } });
check('propietario: x-propietario y 403', propietario['x-propietario'] === 'userId' && propietario.responses['403']);

console.log(`\n${ok} OK, ${fallos} fallas`);
process.exit(fallos === 0 ? 0 : 1);
