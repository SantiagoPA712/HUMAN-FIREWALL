/**
 * HU: arquitectura de microservicios por capas y contratos de API.
 *
 * Pruebas de CONTRATO. Verifican que la API real y su contrato OpenAPI
 * (GET /api/docs/openapi.json) digan lo mismo:
 *
 *   1. El contrato es un documento OpenAPI 3.1 valido.
 *   2. Cada ruta real esta documentada, y cada operacion documentada existe.
 *   3. La seguridad documentada (publica, roles, propietario) es la que
 *      aplica la cadena de middlewares de la ruta.
 *   4. Lo que se documenta como validado por DTO es lo que valida la ruta.
 *   5. Las respuestas reales cumplen los esquemas del contrato, tanto las
 *      exitosas como las de error.
 *   6. Los errores tienen siempre el formato comun y un 500 no filtra
 *      detalles internos.
 *
 * Igual que el resto: PostgreSQL real en WebAssembly (PGlite) y HTTP real
 * contra app.js en un puerto libre.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Validator } from '@seriousme/openapi-schema-validator';
import { levantarApi } from './ayudantes/api-de-prueba.mjs';
import { listarRutas } from './ayudantes/rutas-express.mjs';

let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };

const api = await levantarApi();
const { require_, tokens: T, ids: I, pedir, pg } = api;

const { SERVICIOS } = require_('./servicios');
const contrato = require_('./compartido/contratos/openapi').construir(SERVICIOS);
const rutas = listarRutas(require_);

const METODOS = ['get', 'post', 'put', 'patch', 'delete'];
const operaciones = Object.entries(contrato.paths).flatMap(([ruta, ops]) =>
    Object.entries(ops).filter(([m]) => METODOS.includes(m)).map(([metodo, op]) => ({ ruta, metodo, op }))
);
const clave = (metodo, ruta) => `${metodo.toUpperCase()} ${ruta}`;
const opPorClave = new Map(operaciones.map(o => [clave(o.metodo, o.ruta), o]));

// =====================================================================
console.log('--- EL CONTRATO ES UN OPENAPI VALIDO ---');
// =====================================================================

const validacion = await new Validator().validate(JSON.parse(JSON.stringify(contrato)));
check('el documento cumple el esquema oficial de OpenAPI 3.1', validacion.valid,
    JSON.stringify(validacion.errors)?.slice(0, 400));
check('declara la version del contrato', /^\d+\.\d+\.\d+$/.test(contrato.info.version));
check('declara el esquema de seguridad bearer JWT',
    contrato.components.securitySchemes.bearerAuth?.scheme === 'bearer');
check('hay una etiqueta por servicio', contrato.tags.length === SERVICIOS.length,
    `(${contrato.tags.map(t => t.name).join(', ')})`);

const sinResumen = operaciones.filter(o => !o.op.summary);
check('toda operacion tiene resumen', sinResumen.length === 0, sinResumen.map(o => clave(o.metodo, o.ruta)).join(', '));
const sinExito = operaciones.filter(o => !Object.keys(o.op.responses).some(s => /^[23]/.test(s)));
check('toda operacion documenta su respuesta exitosa', sinExito.length === 0, sinExito.map(o => clave(o.metodo, o.ruta)).join(', '));
const sin500 = operaciones.filter(o => !o.op.responses['500']);
check('toda operacion documenta el 500 con el formato comun', sin500.length === 0);

// =====================================================================
console.log('\n--- RUTAS REALES <-> CONTRATO ---');
// =====================================================================

const reales = new Set(rutas.map(r => clave(r.metodo, r.ruta)));
const sinDocumentar = rutas.filter(r => !opPorClave.has(clave(r.metodo, r.ruta)));
check(`las ${rutas.length} rutas reales estan documentadas`, sinDocumentar.length === 0,
    sinDocumentar.map(r => clave(r.metodo, r.ruta)).join(', '));
const fantasma = operaciones.filter(o => !reales.has(clave(o.metodo, o.ruta)));
check('no se documenta ninguna operacion que no exista', fantasma.length === 0,
    fantasma.map(o => clave(o.metodo, o.ruta)).join(', '));

const malEtiquetadas = rutas.filter(r => {
    const o = opPorClave.get(clave(r.metodo, r.ruta));
    return o && o.op.tags?.[0] !== r.servicio;
});
check('cada operacion esta en la etiqueta del servicio que la atiende', malEtiquetadas.length === 0,
    malEtiquetadas.map(r => `${clave(r.metodo, r.ruta)} -> ${r.servicio}`).join(', '));

const prefijosDeclarados = SERVICIOS.flatMap(s => s.manifiesto.prefijos.map(p => `${s.manifiesto.nombre}:${p}`)).sort();
const prefijosMontados = [...new Set(SERVICIOS.flatMap(s => s.rutas().map(r => `${s.manifiesto.nombre}:${r.prefijo}`)))].sort();
check('los prefijos de cada manifiesto son los que monta el servicio',
    JSON.stringify(prefijosDeclarados) === JSON.stringify(prefijosMontados),
    `(${prefijosDeclarados.join(' ')} vs ${prefijosMontados.join(' ')})`);

// =====================================================================
console.log('\n--- LA SEGURIDAD DOCUMENTADA ES LA QUE SE APLICA ---');
// =====================================================================

const igualesComoConjunto = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const seguridadMal = [];
for (const r of rutas) {
    const o = opPorClave.get(clave(r.metodo, r.ruta));
    if (!o) continue;
    const publica = Array.isArray(o.op.security) && o.op.security.length === 0;
    if (publica === r.autenticada) { seguridadMal.push(`${clave(r.metodo, r.ruta)}: publica=${publica}, token=${r.autenticada}`); continue; }
    if (!publica && !igualesComoConjunto(o.op['x-roles'] || [], r.roles)) {
        seguridadMal.push(`${clave(r.metodo, r.ruta)}: x-roles=${o.op['x-roles']} vs ${r.roles}`);
    }
    if ((o.op['x-propietario'] || null) !== r.propietario) {
        seguridadMal.push(`${clave(r.metodo, r.ruta)}: propietario ${o.op['x-propietario']} vs ${r.propietario}`);
    }
}
check('publica/autenticada, roles y propietario coinciden en todas las rutas', seguridadMal.length === 0, seguridadMal.join(' | '));

const sin401 = operaciones.filter(o => o.op.security?.length && !o.op.responses['401']);
check('toda operacion con token documenta el 401', sin401.length === 0);
const sin403 = operaciones.filter(o => (o.op['x-roles'] || []).length && !o.op.responses['403']);
check('toda operacion con roles documenta el 403', sin403.length === 0);

// =====================================================================
console.log('\n--- LA VALIDACION DOCUMENTADA ES LA QUE SE APLICA ---');
// =====================================================================

const validacionMal = [];
for (const r of rutas) {
    const o = opPorClave.get(clave(r.metodo, r.ruta));
    if (!o) continue;
    const documentada = o.op['x-validacion'] === 'middleware';
    const aplicada = r.dtos.length > 0;
    if (documentada !== aplicada) {
        validacionMal.push(`${clave(r.metodo, r.ruta)}: documentada=${documentada} aplicada=${aplicada}`);
        continue;
    }
    if (!aplicada) continue;
    const dto = Object.assign({}, ...r.dtos);
    const cuerpoDoc = o.op.requestBody?.content?.['application/json']?.schema;
    if ((dto.body || undefined) !== (cuerpoDoc || undefined)) {
        validacionMal.push(`${clave(r.metodo, r.ruta)}: el cuerpo documentado no es el DTO que valida la ruta`);
    }
    const paramsDoc = (o.op.parameters || []).map(p => `${p.in}:${p.name}`).sort().join();
    const paramsDto = [
        ...Object.keys(dto.params?.properties || {}).map(n => `path:${n}`),
        ...Object.keys(dto.query?.properties || {}).map(n => `query:${n}`)
    ].sort().join();
    if (paramsDoc !== paramsDto) validacionMal.push(`${clave(r.metodo, r.ruta)}: parametros ${paramsDoc} vs ${paramsDto}`);
}
check('el DTO documentado es el mismo objeto que valida la ruta', validacionMal.length === 0, validacionMal.join(' | '));

const rutasConParametro = operaciones.filter(o => /\{[^}]+\}/.test(o.ruta));
const parametrosSinDocumentar = rutasConParametro.filter(o => {
    const enRuta = [...o.ruta.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
    const doc = (o.op.parameters || []).filter(p => p.in === 'path').map(p => p.name);
    return enRuta.some(n => !doc.includes(n));
});
check('todo parametro de ruta esta documentado', parametrosSinDocumentar.length === 0,
    parametrosSinDocumentar.map(o => clave(o.metodo, o.ruta)).join(', '));

// =====================================================================
console.log('\n--- LAS RESPUESTAS REALES CUMPLEN EL CONTRATO ---');
// =====================================================================

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const validadores = new Map();
/** Valida un cuerpo contra el esquema documentado para (operacion, status). */
function cumple(metodo, ruta, status, cuerpo) {
    const o = opPorClave.get(clave(metodo, ruta));
    if (!o) return { ok: false, motivo: 'operacion no documentada' };
    let resp = o.op.responses[String(status)];
    if (!resp) return { ok: false, motivo: `status ${status} no documentado` };
    if (resp.$ref) resp = contrato.components.responses[resp.$ref.split('/').pop()];
    const contenido = resp.content?.['application/json'];
    if (!contenido) return { ok: true };
    const k = `${clave(metodo, ruta)} ${status}`;
    if (!validadores.has(k)) {
        validadores.set(k, ajv.compile({ allOf: [contenido.schema], components: contrato.components }));
    }
    const v = validadores.get(k);
    return v(cuerpo) ? { ok: true } : { ok: false, motivo: ajv.errorsText(v.errors) };
}

let llamadas = 0;
const incumplidas = [];
/** Llama a la API y valida la respuesta contra el contrato. */
async function llamar(metodo, rutaContrato, rutaReal, opciones = {}) {
    const r = await pedir(metodo.toUpperCase(), rutaReal, opciones);
    llamadas++;
    const v = cumple(metodo, rutaContrato, r.estado, r.cuerpo);
    if (!v.ok) incumplidas.push(`${clave(metodo, rutaContrato)} -> ${r.estado}: ${v.motivo}`);
    return r;
}

// --- identidad ---
const registro = await llamar('post', '/api/auth/register', '/api/auth/register', { body: { email: 'contrato@hf.com', password: 'Clave1234' } });
await llamar('post', '/api/auth/register', '/api/auth/register', { body: { email: 'contrato@hf.com', password: 'Clave1234' } });
await llamar('post', '/api/auth/login', '/api/auth/login', { body: { email: 'contrato@hf.com', password: 'Clave1234' } });
await llamar('post', '/api/auth/login', '/api/auth/login', { body: { email: 'contrato@hf.com', password: 'Mala1234' } });
await llamar('post', '/api/auth/logout', '/api/auth/logout');
await llamar('post', '/api/auth/forgot-password', '/api/auth/forgot-password', { body: { email: 'contrato@hf.com' } });
await llamar('post', '/api/auth/reset-password', '/api/auth/reset-password', { body: { token: 'no-existe', newPassword: 'Clave1234' } });
await llamar('get', '/api/users/me', '/api/users/me', { token: T.employee });
await llamar('patch', '/api/users/me', '/api/users/me', { token: T.employee, body: { language: 'en' } });
await llamar('get', '/api/users', '/api/users', { token: T.admin });
await llamar('post', '/api/users', '/api/users', { token: T.admin, body: { email: 'alta@hf.com', password: 'x', role: 'rh' } });
await llamar('post', '/api/users', '/api/users', { token: T.admin, body: { email: 'alta@hf.com', password: 'x', role: 'rh' } });
await llamar('put', '/api/users/{id}', `/api/users/${I.instructor}`, { token: T.admin, body: { is_active: true } });
await llamar('put', '/api/users/{id}', '/api/users/999999', { token: T.admin, body: { role: 'rh' } });
await llamar('delete', '/api/users/{id}', `/api/users/${I.manager}`, { token: T.admin });
const inv = await llamar('post', '/api/invitations', '/api/invitations', { token: T.admin, body: { email: 'invitado@hf.com', role: 'employee' } });
await llamar('post', '/api/invitations', '/api/invitations', { token: T.admin, body: { email: 'invitado@hf.com', role: 'employee' } });
await llamar('get', '/api/invitations', '/api/invitations', { token: T.admin });
await llamar('post', '/api/invitations/{id}/reenviar', `/api/invitations/${inv.cuerpo.id}/reenviar`, { token: T.admin });
await llamar('post', '/api/invitations/validar', '/api/invitations/validar', { body: { token: 'no-existe' } });
await llamar('post', '/api/invitations/aceptar', '/api/invitations/aceptar', { body: { token: 'no-existe', password: 'Clave1234', full_name: 'Ana Gomez' } });
await llamar('post', '/api/invitations/solicitar-reenvio', '/api/invitations/solicitar-reenvio', { body: { token: 'no-existe' } });
await llamar('post', '/api/invitations/{id}/cancelar', `/api/invitations/${inv.cuerpo.id}/cancelar`, { token: T.admin });
await llamar('get', '/api/sso/google', '/api/sso/google');

// --- cursos ---
const curso = await llamar('post', '/api/courses', '/api/courses', { token: T.instructor, body: { title: 'Curso de contrato', description: 'd' } });
await llamar('post', '/api/courses', '/api/courses', { token: T.instructor, body: { description: 'sin titulo' } });
const leccion = await llamar('post', '/api/courses/{courseId}/contents', `/api/courses/${curso.cuerpo.id}/contents`, { token: T.instructor, body: { content_type: 'texto', body: 'hola' } });
await llamar('post', '/api/courses/assign', '/api/courses/assign', { token: T.rh, body: { course_id: curso.cuerpo.id, user_id: I.employee, due_date: '2030-01-01' } });
await llamar('get', '/api/courses', '/api/courses', { token: T.employee });
await llamar('get', '/api/courses', '/api/courses', { token: T.admin });
await llamar('get', '/api/courses/{courseId}', `/api/courses/${curso.cuerpo.id}`, { token: T.employee });
await llamar('get', '/api/courses/{courseId}', '/api/courses/999999', { token: T.employee });
await llamar('get', '/api/courses/{courseId}', '/api/courses/abc', { token: T.employee });
await llamar('post', '/api/courses/contents/{contentId}/complete', `/api/courses/contents/${leccion.cuerpo.id}/complete`, { token: T.employee });
await llamar('post', '/api/courses/contents/{contentId}/complete', `/api/courses/contents/${leccion.cuerpo.id}/complete`, { token: T.employee });
await llamar('get', '/api/courses/{courseId}/progress', `/api/courses/${curso.cuerpo.id}/progress`, { token: T.employee });

// --- evaluaciones ---
const sim = await llamar('post', '/api/simulations', '/api/simulations', { token: T.instructor, body: { title: 'Simulacion de contrato' } });
const paso = await llamar('post', '/api/simulations/{simulationId}/steps', `/api/simulations/${sim.cuerpo.id}/steps`, { token: T.instructor, body: { scenario_text: 'Te llega un correo...' } });
const opcion = await llamar('post', '/api/simulations/steps/{stepId}/options', `/api/simulations/steps/${paso.cuerpo.id}/options`, { token: T.instructor, body: { option_text: 'Reportarlo', is_correct: true, points_awarded: 10, feedback_text: 'Bien' } });
await llamar('get', '/api/simulations', '/api/simulations', { token: T.employee });
await llamar('get', '/api/simulations/{simulationId}', `/api/simulations/${sim.cuerpo.id}`, { token: T.employee });
await llamar('post', '/api/simulations/submit-decision', '/api/simulations/submit-decision', { token: T.employee, body: { optionId: opcion.cuerpo.id } });
await llamar('post', '/api/simulations/submit-decision', '/api/simulations/submit-decision', { token: T.employee, body: {} });
await llamar('post', '/api/simulations/{simulationId}/complete', `/api/simulations/${sim.cuerpo.id}/complete`, { token: T.employee, body: { decisiones: [opcion.cuerpo.id] } });
await llamar('post', '/api/simulations/{simulationId}/complete', `/api/simulations/${sim.cuerpo.id}/complete`, { token: T.employee, body: { decisiones: [999999] } });
await llamar('post', '/api/gamification/challenge', '/api/gamification/challenge', { token: T.employee, body: { challengeId: 'phishing', passed: true, score: 90 } });
await llamar('post', '/api/gamification/challenge', '/api/gamification/challenge', { token: T.employee, body: { challengeId: 'no-existe' } });
await api.require_('./compartido/eventos/eventBus').procesarPendientes();

// --- gamificacion ---
for (const ruta of ['/api/gamification/leaderboard', '/api/gamification/me', '/api/gamification/points/rules',
                    '/api/gamification/rewards', '/api/gamification/levels']) {
    await llamar('get', ruta, ruta, { token: T.employee });
}
for (const ruta of ['points', 'rewards', 'level', 'performance', 'recommendations']) {
    await llamar('get', `/api/gamification/${ruta}/{userId}`, `/api/gamification/${ruta}/${I.employee}`, { token: T.employee });
    await llamar('get', `/api/gamification/${ruta}/{userId}`, `/api/gamification/${ruta}/${I.employee}`, { token: T.instructor });
}
await llamar('get', '/api/gamification/points/{userId}', '/api/gamification/points/999999', { token: T.admin });
await llamar('post', '/api/gamification/badges', '/api/gamification/badges', { token: T.admin, body: { name: 'Insignia de contrato', threshold: 5 } });
await llamar('post', '/api/gamification/badges/assign', '/api/gamification/badges/assign', { token: T.admin, body: { user_id: I.employee, reward_id: 1, reason: 'Premio' } });
await llamar('post', '/api/gamification/badges/assign', '/api/gamification/badges/assign', { token: T.admin, body: { user_id: I.employee, reward_id: 1, reason: 'Otra vez' } });
await llamar('post', '/api/gamification/badges/assign', '/api/gamification/badges/assign', { token: T.admin, body: { user_id: I.employee, reward_id: 1 } });

// --- notificaciones ---
for (const ruta of ['/api/notifications', '/api/notifications/resultados', '/api/notifications/preferencias',
                    '/api/notifications/correo/preferencias']) {
    await llamar('get', ruta, ruta, { token: T.employee });
}
await llamar('get', '/api/notifications/cursos-criticos', '/api/notifications/cursos-criticos', { token: T.rh });
await llamar('get', '/api/notifications/correo/estado', '/api/notifications/correo/estado', { token: T.admin });
await llamar('get', '/api/notifications/eventos/estado', '/api/notifications/eventos/estado', { token: T.admin });
await llamar('patch', '/api/notifications/preferencias', '/api/notifications/preferencias', { token: T.employee, body: { email: false } });
await llamar('patch', '/api/notifications/correo/preferencias', '/api/notifications/correo/preferencias', { token: T.employee, body: { tipos: { course_assigned: false } } });
await llamar('patch', '/api/notifications/cursos-criticos/{courseId}', `/api/notifications/cursos-criticos/${curso.cuerpo.id}`, { token: T.rh, body: { is_critical: true } });
await llamar('patch', '/api/notifications/leidas', '/api/notifications/leidas', { token: T.employee });
await llamar('patch', '/api/notifications/{id}/leida', '/api/notifications/999999/leida', { token: T.employee });

// --- reportes ---
for (const ruta of ['/api/gamification/reports/filters', '/api/gamification/reports/performance']) {
    await llamar('get', ruta, ruta, { token: T.rh });
}
await llamar('get', '/api/gamification/reports/performance', '/api/gamification/reports/performance?from=no-es-fecha', { token: T.rh });
await llamar('get', '/api/gamification/reports/exports/{exportId}', '/api/gamification/reports/exports/no-existe', { token: T.rh });
await llamar('get', '/api/gamification/reports/schedules', '/api/gamification/reports/schedules', { token: T.admin });
await llamar('post', '/api/gamification/reports/schedules', '/api/gamification/reports/schedules', { token: T.admin, body: { name: 'Diario', report_type: 'performance', frequency: 'daily', format: 'csv', subscriber_roles: ['rh'] } });
await llamar('patch', '/api/gamification/reports/schedules/{id}', '/api/gamification/reports/schedules/1', { token: T.admin, body: { is_active: false } });
await llamar('get', '/api/gamification/reports/history', '/api/gamification/reports/history', { token: T.manager });
await llamar('get', '/api/gamification/reports/organizational', '/api/gamification/reports/organizational', { token: T.manager });
await llamar('get', '/api/gamification/reports/organizational', '/api/gamification/reports/organizational?area_id=999', { token: T.manager });

// --- seguridad ---
for (const ruta of ['/api/gamification/security/rules', '/api/gamification/security/audit', '/api/gamification/security/anomalies']) {
    await llamar('get', ruta, ruta, { token: T.security });
}
await llamar('get', '/api/gamification/security/anomalies/{id}', '/api/gamification/security/anomalies/999', { token: T.security });
await llamar('patch', '/api/gamification/users/{id}/adjust', `/api/gamification/users/${I.employee}/adjust`, { token: T.admin, body: { change_type: 'points', value: 25, reason: 'Correccion' } });
await llamar('patch', '/api/gamification/users/{id}/adjust', `/api/gamification/users/${I.employee}/adjust`, { token: T.admin, body: { change_type: 'points', value: 25 } });
await api.require_('./compartido/eventos/eventBus').procesarPendientes();
await llamar('get', '/api/logs', '/api/logs', { token: T.admin });
await llamar('get', '/api/logs/filtros', '/api/logs/filtros', { token: T.admin });
const listaLogs = await pedir('GET', '/api/logs', { token: T.admin });
const primerLog = listaLogs.cuerpo.resultados?.[0];
if (primerLog) await llamar('get', '/api/logs/{id}', `/api/logs/${primerLog.id}`, { token: T.admin });
await llamar('get', '/api/logs/{id}', '/api/logs/999999', { token: T.admin });

check(`${llamadas} respuestas reales (exitosas y de error) cumplen el contrato`, incumplidas.length === 0,
    '\n        ' + incumplidas.join('\n        '));
check('el registro devolvio un token', typeof registro.cuerpo?.token === 'string');

// =====================================================================
console.log('\n--- ERRORES CON FORMATO COMUN (criterios de aceptacion 6 y 7) ---');
// =====================================================================

const consultasAntes = () => api.estado.consultas;

let antes = consultasAntes();
const sinToken = await pedir('GET', '/api/courses');
check('sin token: 401 con codigo NO_AUTENTICADO', sinToken.estado === 401 && sinToken.cuerpo.codigo === 'NO_AUTENTICADO');
const tokenFalso = await pedir('GET', '/api/courses', { token: 'no.es.un.jwt' });
check('token invalido: 401', tokenFalso.estado === 401 && tokenFalso.cuerpo.codigo === 'NO_AUTENTICADO');
const sinRol = await pedir('GET', '/api/logs', { token: T.employee });
check('rol insuficiente: 403 con codigo PROHIBIDO', sinRol.estado === 403 && sinRol.cuerpo.codigo === 'PROHIBIDO');
check('ni el 401 ni el 403 consultaron la base', consultasAntes() === antes, `(${consultasAntes() - antes} consultas)`);

antes = consultasAntes();
const invalido = await pedir('POST', '/api/courses', { token: T.instructor, body: { title: '', points: 'x' } });
check('DTO invalido: 400 con el detalle por campo',
    invalido.estado === 400 && invalido.cuerpo.codigo === 'VALIDACION' &&
    invalido.cuerpo.errores?.some(e => e.campo === 'title'), JSON.stringify(invalido.cuerpo));
check('y el 400 sale antes de tocar la base', consultasAntes() === antes);

const tipoMal = await pedir('POST', '/api/simulations/1/complete', { token: T.employee, body: { decisiones: 'todas' } });
check('un tipo equivocado tambien es 400 con el campo', tipoMal.estado === 400 && tipoMal.cuerpo.errores?.[0]?.campo === 'decisiones');

const parametroMal = await pedir('GET', '/api/simulations/abc', { token: T.employee });
check('un parametro de ruta invalido es 400, no 500', parametroMal.estado === 400 && parametroMal.cuerpo.errores?.[0]?.campo === 'simulationId');

const jsonRoto = await pedir('POST', '/api/courses', { token: T.instructor, crudo: '{"title": ' });
check('JSON mal formado: 400 JSON_INVALIDO', jsonRoto.estado === 400 && jsonRoto.cuerpo.codigo === 'JSON_INVALIDO');

const inexistente = await pedir('GET', '/api/no-existe');
check('endpoint inexistente: 404 en JSON (no HTML)', inexistente.estado === 404 && inexistente.cuerpo.codigo === 'NO_ENCONTRADO');

// Base caida: el 500 no puede filtrar el texto del error.
api.estado.caida = true;
const errorOriginal = console.error;
const registrados = [];
console.error = (...a) => registrados.push(a.map(String).join(' '));
const caida = await pedir('GET', '/api/courses', { token: T.admin, headers: { 'X-Trace-Id': 'traza-contrato-500' } });
const loginCaida = await pedir('POST', '/api/auth/login', { body: { email: 'contrato@hf.com', password: 'Clave1234' } });
api.estado.caida = false;
console.error = errorOriginal;
const texto500 = JSON.stringify(caida.cuerpo);
check('con la base caida responde 500 ERROR_INTERNO', caida.estado === 500 && caida.cuerpo.codigo === 'ERROR_INTERNO');
check('el 500 no trae el mensaje interno (ni la IP, ni la tabla, ni la clave)',
    !/ECONNREFUSED|10\.9\.9\.9|relation|supersecreta/.test(texto500), texto500);
check('el 500 trae el traceId de la solicitud para buscarlo en los logs', caida.cuerpo.traceId === 'traza-contrato-500');
check('el mismo traceId vuelve en el encabezado X-Trace-Id', caida.headers.get('x-trace-id') === 'traza-contrato-500');
check('el detalle si queda en el log del servidor, con el mismo traceId',
    registrados.some(l => l.includes('traza-contrato-500')) && registrados.some(l => /ECONNREFUSED/.test(l)));
check('el login con la base caida es un 500 generico, no un 401 con el error crudo',
    loginCaida.estado === 500 && !/ECONNREFUSED/.test(JSON.stringify(loginCaida.cuerpo)));

// Recuperacion de contrasena: no revela que correos estan registrados.
const conCuenta = await pedir('POST', '/api/auth/forgot-password', { body: { email: 'contrato@hf.com' } });
const sinCuenta = await pedir('POST', '/api/auth/forgot-password', { body: { email: 'nadie@hf.com' } });
check('forgot-password responde igual exista o no la cuenta',
    conCuenta.estado === 200 && sinCuenta.estado === 200 && conCuenta.cuerpo.msg === sinCuenta.cuerpo.msg);

// =====================================================================
console.log('\n--- DOCUMENTACION SERVIDA ---');
// =====================================================================

const json = await pedir('GET', '/api/docs/openapi.json');
check('GET /api/docs/openapi.json devuelve el contrato', json.estado === 200 && json.cuerpo.openapi === '3.1.0' &&
    Object.keys(json.cuerpo.paths).length === Object.keys(contrato.paths).length);
const ui = await pedir('GET', '/api/docs/');
check('GET /api/docs/ sirve Swagger UI', ui.estado === 200 && /swagger/i.test(ui.cuerpo));
check('la documentacion es publica (no pide token) pero no aparece como operacion del contrato',
    !Object.keys(contrato.paths).some(p => p.startsWith('/api/docs')));

await api.cerrar();
console.log(`\n${ok} OK, ${fallos} fallas`);
process.exit(fallos === 0 ? 0 : 1);
