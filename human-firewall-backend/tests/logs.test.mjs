/**
 * HU: registro centralizado de logs de auditoria (data.logs).
 *
 * Igual que el resto: PostgreSQL real en WebAssembly (PGlite), sin mocks del
 * SQL. La parte de la API se prueba por HTTP de verdad, levantando app.js en
 * un puerto libre: asi el control de acceso se verifica con la cadena de
 * middlewares real y no con una copia armada a mano.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';
process.env.JWT_EXPIRES = process.env.JWT_EXPIRES || '1d';
process.env.NODE_ENV = 'test';

const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const msg = e => e?.message || String(e);

// Adaptador del pool con dos ganchos para las pruebas:
//   - contar consultas (criterio tecnico 3: el 403 no toca la base)
//   - simular que la cola esta caida (criterio tecnico 2)
let consultas = 0;
let colaCaida = false;
let conexionesAbiertas = 0;

const ejecutar = (t, p) => {
    consultas++;
    if (colaCaida && /INSERT INTO event_outbox/i.test(t)) {
        return Promise.reject(new Error('simulado: event_outbox no disponible'));
    }
    return pg.query(t, p);
};

const adapter = {
    query: ejecutar,
    connect: async () => {
        conexionesAbiertas++;
        let devuelta = false;
        return {
            query: ejecutar,
            release: () => { if (!devuelta) { devuelta = true; conexionesAbiertas--; } }
        };
    }
};
const dbPath = require_.resolve('./config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
for (const archivo of readdirSync(`${DIR}migrations`).filter(f => f.endsWith('.sql')).sort()) {
    try { await pg.exec(readFileSync(`${DIR}migrations/${archivo}`, 'utf8')); }
    catch (e) { console.log(`ERROR en ${archivo}: ${msg(e)}`); fallos++; }
}
console.log('Esquema y migraciones listos\n');

const eventBus = require_('./services/eventBus');
const dataLogs = require_('./services/dataLogs.service');
const userController = require_('./controllers/user.controller');
const jwt = require_('jsonwebtoken');
const app = require_('./app');

dataLogs.registrarHandlers();

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/** Deja que corran los setImmediate del bus y drena la cola. */
const drenar = async () => { await esperar(5); await eventBus.procesarPendientes(); };

const contar = async (sql, params = []) => Number((await pg.query(sql, params)).rows[0].n);

/** Stubs de req/res para ejercitar controladores sin HTTP. */
const llamar = async (handler, { body = {}, params = {}, query = {}, user, ip = '10.0.0.7', traceId = 'traza-de-prueba-01' } = {}) => {
    let estado = 200, cuerpo = null;
    const res = { status(c) { estado = c; return this; }, json(b) { cuerpo = b; return this; } };
    await handler({ body, params, query, user, ip, traceId }, res);
    return { estado, cuerpo };
};

// --- Usuarios de la prueba ---
await pg.exec(`
  INSERT INTO users (email, password, role) VALUES
    ('empleado@hf.com', 'x', 'employee'),
    ('auditado@hf.com', 'x', 'employee');
`);
const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const admin = await idDe('admin@humanfirewall.com');
const empleado = await idDe('empleado@hf.com');
const auditado = await idDe('auditado@hf.com');

const tokenDe = (id, role) => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const TOKEN_ADMIN = tokenDe(admin, 'admin');

// --- Servidor HTTP real ---
const servidor = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://127.0.0.1:${servidor.address().port}`;

const pedir = async (ruta, { token, method = 'GET', headers = {} } = {}) => {
    const r = await fetch(`${BASE}${ruta}`, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
    });
    const tipo = r.headers.get('content-type') || '';
    const cuerpo = tipo.includes('json') ? await r.json() : await r.text();
    return { estado: r.status, cuerpo, headers: r.headers };
};

// =====================================================================
console.log('--- ESQUEMA E INDICES (criterios tecnicos 1 y 8) ---');
// =====================================================================

check('data.logs existe dentro del esquema data',
    await contar(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'data' AND table_name = 'logs'`) === 1);

const { rows: columnas } = await pg.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'data' AND table_name = 'logs'`);
const nombres = new Set(columnas.map(c => c.column_name));
const exigidas = ['id', 'user_id', 'action_type', 'resource_type', 'resource_id', 'old_value',
                  'new_value', 'ip_address', 'trace_id', 'occurred_at', 'actor_type', 'module'];
check('tiene todos los campos del criterio tecnico 1 (+ actor_type y module)',
    exigidas.every(c => nombres.has(c)), `(faltan: ${exigidas.filter(c => !nombres.has(c)).join(', ')})`);

const { rows: indices } = await pg.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'data' AND tablename = 'logs'`);
const indexado = (col) => indices.some(i => new RegExp(`\\(${col}\\b`).test(i.indexdef));
for (const col of ['user_id', 'action_type', 'occurred_at', 'resource_type']) {
    check(`indice que empieza por ${col}`, indexado(col));
}

check('no tiene llaves foraneas: el log sobrevive a lo que audita',
    await contar(`SELECT COUNT(*) AS n FROM information_schema.table_constraints
                   WHERE table_schema = 'data' AND table_name = 'logs' AND constraint_type = 'FOREIGN KEY'`) === 0);

// =====================================================================
console.log('\n--- ENMASCARADO (criterio tecnico 5) ---');
// =====================================================================

const original = {
    email: 'a@hf.com',
    password: 'Secreta123',
    perfil: { reset_token: 'abc', nombre: 'Ana' },
    nota: jwt.sign({ x: 1 }, 'k'),
    dato_viejo: '$2b$10$abcdefghijklmnopqrstuv',
    lista: [{ apiKey: 'k-1' }, { valor: 3 }]
};
const limpio = dataLogs.enmascarar(original);

check('la contrasena queda como [REDACTED]', limpio.password === '[REDACTED]');
check('un token anidado tambien', limpio.perfil.reset_token === '[REDACTED]');
check('los campos normales se conservan', limpio.email === 'a@hf.com' && limpio.perfil.nombre === 'Ana');
check('un JWT pegado en un campo inocente se detecta por el valor', limpio.nota === '[REDACTED]');
check('un hash bcrypt tambien', limpio.dato_viejo === '[REDACTED]');
check('dentro de listas tambien', limpio.lista[0].apiKey === '[REDACTED]' && limpio.lista[1].valor === 3);
check('no modifica el objeto original', original.password === 'Secreta123');

// =====================================================================
console.log('\n--- REGISTRO ASINCRONO (criterio tecnico 2) ---');
// =====================================================================

const uid = await dataLogs.registrar({
    req: { user: { id: admin }, ip: '::ffff:192.168.1.20', traceId: 'traza-asincrona-1' },
    accion: dataLogs.ACCIONES.CONFIG_CHANGE,
    modulo: dataLogs.MODULOS.SYSTEM,
    recurso: 'config',
    recursoId: 'smtp',
    antes: { host: 'viejo', smtp_password: 'clave-vieja' },
    despues: { host: 'nuevo', smtp_password: 'clave-nueva' }
});

check('registrar() devuelve el uid del log encolado', typeof uid === 'string' && uid.length === 36);
check('la accion NO escribe en data.logs dentro del request',
    await contar('SELECT COUNT(*) AS n FROM data.logs WHERE log_uid = $1', [uid]) === 0);

const { rows: [enCola] } = await pg.query(
    `SELECT payload FROM event_outbox WHERE event_name = 'audit.log_recorded' AND payload->>'logUid' = $1`, [uid]);
check('queda encolado en el bus', !!enCola);
check('la cola tampoco guarda el secreto en texto plano',
    !JSON.stringify(enCola.payload).includes('clave-nueva') && !JSON.stringify(enCola.payload).includes('clave-vieja'));

await drenar();

const { rows: [fila] } = await pg.query('SELECT * FROM data.logs WHERE log_uid = $1', [uid]);
check('al drenar la cola la fila aparece', !!fila);
check('con el actor y su correo resuelto por el worker', fila.user_id === admin && fila.actor_email === 'admin@humanfirewall.com');
check('IP normalizada (sin ::ffff:)', fila.ip_address === '192.168.1.20', `(${fila.ip_address})`);
check('con el trace_id del request', fila.trace_id === 'traza-asincrona-1');
check('old/new guardados y enmascarados',
    fila.old_value.host === 'viejo' && fila.new_value.smtp_password === '[REDACTED]');
check('occurred_at es la hora del servidor al registrar, no la del worker',
    new Date(fila.occurred_at).toISOString() === enCola.payload.occurredAt);

// Reintento del bus: el mismo payload llega dos veces.
await dataLogs.persistir(enCola.payload);
check('reprocesar el evento no duplica la fila (idempotencia por log_uid)',
    await contar('SELECT COUNT(*) AS n FROM data.logs WHERE log_uid = $1', [uid]) === 1);

// La cola cae: la operacion de negocio tiene que salir igual.
colaCaida = true;
const errorOriginal = console.error;
let avisos = 0;
console.error = () => { avisos++; };

const resultadoSinCola = await dataLogs.registrar({
    req: { user: { id: admin } }, accion: 'update', modulo: 'users', recurso: 'user', recursoId: 1
});
check('si el log no se puede encolar, registrar() no lanza', resultadoSinCola === null);

const cambioSinCola = await llamar(userController.updateUser, {
    params: { id: String(auditado) }, body: { role: 'instructor' }, user: { id: admin, role: 'admin' }
});
await esperar(20);
console.error = errorOriginal;
colaCaida = false;

const { rows: [trasFallo] } = await pg.query('SELECT role FROM users WHERE id = $1', [auditado]);
check('con la cola caida el cambio de rol responde 200', cambioSinCola.estado === 200, `(${cambioSinCola.estado})`);
check('y el cambio NO se revierte por culpa del log', trasFallo.role === 'instructor');
check('el fallo del log queda en la salida del servidor', avisos > 0);

// =====================================================================
console.log('\n--- ACCIONES CRITICAS (criterio tecnico 1) ---');
// =====================================================================

// Cambio de rol, con la cola sana.
const cambio = await llamar(userController.updateUser, {
    params: { id: String(auditado) }, body: { role: 'admin' }, user: { id: admin, role: 'admin' }
});
await drenar();
const { rows: [logRol] } = await pg.query(
    `SELECT * FROM data.logs WHERE action_type = 'role_change' AND resource_id = $1 ORDER BY id DESC LIMIT 1`,
    [String(auditado)]);
check('cambiar el rol responde 200', cambio.estado === 200);
check('queda un log role_change', !!logRol);
check('con el valor anterior y el nuevo',
    logRol?.old_value?.role === 'instructor' && logRol?.new_value?.role === 'admin');
check('modulo users y recurso user', logRol?.module === 'users' && logRol?.resource_type === 'user');
check('con la IP de origen', logRol?.ip_address === '10.0.0.7');

// Rol invalido: antes era un 500 con el error crudo de Postgres.
const logsAntes = await contar('SELECT COUNT(*) AS n FROM data.logs');
const rolMalo = await llamar(userController.updateUser, {
    params: { id: String(auditado) }, body: { role: 'superadmin' }, user: { id: admin, role: 'admin' }
});
await drenar();
check('un rol invalido responde 400 con el campo', rolMalo.estado === 400 && rolMalo.cuerpo.errores?.[0]?.campo === 'role');
check('y no deja log de un cambio que no ocurrio', await contar('SELECT COUNT(*) AS n FROM data.logs') === logsAntes);

const inexistente = await llamar(userController.updateUser, {
    params: { id: '999999' }, body: { role: 'rh' }, user: { id: admin, role: 'admin' }
});
check('un usuario inexistente responde 404', inexistente.estado === 404);

// Alta: el body trae la contrasena.
const alta = await llamar(userController.create, {
    body: { email: 'nuevo-rh@hf.com', password: 'Clave-En-Claro-1', role: 'rh' }, user: { id: admin, role: 'admin' }
});
await drenar();
const { rows: [logAlta] } = await pg.query(
    `SELECT * FROM data.logs WHERE action_type = 'create' AND module = 'users' ORDER BY id DESC LIMIT 1`);
check('crear un usuario responde 201', alta.estado === 201);
check('queda log de creacion con el correo', logAlta?.new_value?.email === 'nuevo-rh@hf.com');
check('la contrasena del alta queda [REDACTED]', logAlta?.new_value?.password === '[REDACTED]');
check('y no aparece en ninguna parte de la fila', !JSON.stringify(logAlta).includes('Clave-En-Claro-1'));

// Baja logica.
await llamar(userController.deactivateUser, { params: { id: String(empleado) }, user: { id: admin, role: 'admin' } });
await drenar();
const { rows: [logBaja] } = await pg.query(
    `SELECT * FROM data.logs WHERE action_type = 'deactivate' AND resource_id = $1`, [String(empleado)]);
check('la baja queda como deactivate con el estado anterior',
    logBaja?.old_value?.is_active === true && logBaja?.new_value?.is_active === false);

// Accion del sistema.
await dataLogs.registrar({ sistema: true, accion: 'config_change', modulo: 'system', recurso: 'job', recursoId: 'kpis' });
await drenar();
const { rows: [logSistema] } = await pg.query(
    `SELECT * FROM data.logs WHERE resource_type = 'job' ORDER BY id DESC LIMIT 1`);
check('una accion del sistema queda con actor_type system y sin user_id',
    logSistema?.actor_type === 'system' && logSistema?.user_id === null);

// =====================================================================
console.log('\n--- LOGIN FALLIDO Y BYPASS ---');
// =====================================================================

const loginMalo = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trace-Id': 'traza-login-0001' },
    body: JSON.stringify({ email: 'admin@humanfirewall.com', password: 'NoEsLaClave1' })
});
await drenar();
const { rows: [logLogin] } = await pg.query(
    `SELECT * FROM data.logs WHERE action_type = 'login_failed' ORDER BY id DESC LIMIT 1`);
check('un login fallido responde 401', loginMalo.status === 401);
check('y queda registrado como login_failed', !!logLogin);
check('con el id de la cuenta que se intento usar', logLogin?.user_id === admin);
check('con el trace_id que vino en el encabezado', logLogin?.trace_id === 'traza-login-0001');
check('con la IP real de la conexion', logLogin?.ip_address === '127.0.0.1', `(${logLogin?.ip_address})`);
check('sin la contrasena intentada', !JSON.stringify(logLogin).includes('NoEsLaClave1'));

const bypass = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@humanfirewall.com', password: 'AdminPassword123!' })
});
const cuerpoBypass = await bypass.json();
check('el bypass de admin ya no existe: esa clave no entrega token', bypass.status === 401 && !cuerpoBypass.token);
await drenar();

const loginFantasma = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nadie@hf.com', password: 'Algo12345' })
});
await drenar();
const { rows: [logFantasma] } = await pg.query(
    `SELECT * FROM data.logs WHERE action_type = 'login_failed' AND actor_email = 'nadie@hf.com'`);
check('un login con un correo inexistente tambien se registra', loginFantasma.status === 401 && !!logFantasma);
check('sin user_id, pero con el correo intentado', logFantasma?.user_id === null);

// =====================================================================
console.log('\n--- CONTROL DE ACCESO (criterio tecnico 3) ---');
// =====================================================================

const sinToken = await pedir('/api/logs');
check('sin token responde 401', sinToken.estado === 401);

const tokenFalso = await pedir('/api/logs', { token: jwt.sign({ id: admin, role: 'admin' }, 'otra-clave') });
check('un token firmado con otra clave responde 401', tokenFalso.estado === 401);

for (const rol of ['employee', 'rh', 'security', 'manager']) {
    const r = await pedir('/api/logs', { token: tokenDe(empleado, rol) });
    check(`rol ${rol} recibe 403`, r.estado === 403);
}

await drenar();
consultas = 0;
await pedir('/api/logs', { token: tokenDe(empleado, 'employee') });
await pedir('/api/logs/export', { token: tokenDe(empleado, 'employee') });
await pedir('/api/logs/1', { token: tokenDe(empleado, 'security') });
check('el 403 sale sin ejecutar ninguna consulta a la base', consultas === 0, `(hizo ${consultas})`);

const conAdmin = await pedir('/api/logs', { token: TOKEN_ADMIN });
check('admin recibe 200', conAdmin.estado === 200);
check('la respuesta trae el X-Trace-Id', /^[0-9a-f-]{36}$/.test(conAdmin.headers.get('x-trace-id') || ''));

// =====================================================================
console.log('\n--- INMUTABILIDAD (criterio tecnico 4) ---');
// =====================================================================

for (const [metodo, ruta] of [['PUT', '/api/logs/1'], ['PATCH', '/api/logs/1'], ['DELETE', '/api/logs/1'], ['POST', '/api/logs'], ['DELETE', '/api/logs']]) {
    const r = await pedir(ruta, { token: TOKEN_ADMIN, method: metodo });
    check(`${metodo} ${ruta} responde 405 aun siendo admin`, r.estado === 405);
}
const deleteEmpleado = await pedir('/api/logs/1', { token: tokenDe(empleado, 'employee'), method: 'DELETE' });
check('y a un no-admin el middleware lo corta antes, con 403', deleteEmpleado.estado === 403);

const { rows: [cualquiera] } = await pg.query('SELECT id FROM data.logs ORDER BY id LIMIT 1');
let errUpdate = null, errDelete = null, errTruncate = null;
try { await pg.query(`UPDATE data.logs SET action_type = 'nada' WHERE id = $1`, [cualquiera.id]); } catch (e) { errUpdate = e; }
try { await pg.query('DELETE FROM data.logs WHERE id = $1', [cualquiera.id]); } catch (e) { errDelete = e; }
try { await pg.query('TRUNCATE data.logs'); } catch (e) { errTruncate = e; }
check('la base rechaza UPDATE', !!errUpdate);
check('la base rechaza DELETE manual', !!errDelete && /retencion/.test(msg(errDelete)));
check('la base rechaza TRUNCATE', !!errTruncate);

const { rows: permisos } = await pg.query(
    `SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'data' AND table_name = 'logs' AND grantee = 'PUBLIC'`);
check('PUBLIC no tiene UPDATE ni DELETE sobre data.logs',
    !permisos.some(p => ['UPDATE', 'DELETE', 'TRUNCATE'].includes(p.privilege_type)));

// =====================================================================
console.log('\n--- LISTADO, FILTROS Y PAGINACION (aceptacion 1 y 2, tecnico 7) ---');
// =====================================================================

// Siembra controlada: 120 logs de exportacion de reportes repartidos en 120
// horas, a nombre del empleado, mas algunos de otros modulos.
const base = Date.parse('2026-03-01T12:00:00Z');
for (let i = 0; i < 120; i++) {
    const p = dataLogs.construirPayload({
        accion: 'export', modulo: 'reports', recurso: 'performance_report', recursoId: `exp-${i}`,
        userId: empleado, despues: { n: i }, traceId: `siembra-${i}`
    });
    p.occurredAt = new Date(base + i * 3600 * 1000).toISOString();
    await dataLogs.persistir(p);
}

const pagina1 = await pedir('/api/logs?module=reports&action_type=export', { token: TOKEN_ADMIN });
check('por defecto pagina de a 50', pagina1.cuerpo.resultados.length === 50 && pagina1.cuerpo.paginacion.page_size === 50);
check('con metadatos page, page_size y total',
    pagina1.cuerpo.paginacion.page === 1 && pagina1.cuerpo.paginacion.total >= 120,
    JSON.stringify(pagina1.cuerpo.paginacion));
check('por defecto del mas reciente al mas antiguo',
    pagina1.cuerpo.resultados.every((r, i, a) => i === 0 || new Date(a[i - 1].occurred_at) >= new Date(r.occurred_at)));

const cada = pagina1.cuerpo.resultados[0];
check('cada fila trae usuario, tipo de accion, recurso y fecha/hora',
    cada.actor_email && cada.action_type && cada.resource_type && cada.occurred_at);
check('el listado NO trae old/new (van en el detalle)', !('old_value' in cada) && !('new_value' in cada));

const pagina3 = await pedir('/api/logs?module=reports&action_type=export&page=3', { token: TOKEN_ADMIN });
check('la pagina 3 trae el resto', pagina3.cuerpo.resultados.length === pagina1.cuerpo.paginacion.total - 100);

const asc = await pedir('/api/logs?module=reports&order=asc&page_size=5', { token: TOKEN_ADMIN });
check('order=asc invierte el orden', asc.cuerpo.resultados[0].resource_id === 'exp-0');

const rango = await pedir('/api/logs?module=reports&from=2026-03-02&to=2026-03-02', { token: TOKEN_ADMIN });
check('filtro por fecha: un dia completo son 24 registros', rango.cuerpo.paginacion.total === 24,
    `(${rango.cuerpo.paginacion?.total})`);

const porUsuario = await pedir(`/api/logs?user_id=${empleado}&module=reports`, { token: TOKEN_ADMIN });
check('filtro por usuario', porUsuario.cuerpo.paginacion.total === 120 &&
    porUsuario.cuerpo.resultados.every(r => r.user_id === empleado));

const soloSistema = await pedir('/api/logs?user_id=system', { token: TOKEN_ADMIN });
check('user_id=system trae solo acciones del sistema', soloSistema.cuerpo.paginacion.total >= 1 &&
    soloSistema.cuerpo.resultados.every(r => r.actor_type === 'system'));

const porAccion = await pedir('/api/logs?action_type=role_change', { token: TOKEN_ADMIN });
check('filtro por tipo de accion', porAccion.cuerpo.resultados.length >= 1 &&
    porAccion.cuerpo.resultados.every(r => r.action_type === 'role_change'));

const vacio = await pedir('/api/logs?module=security&from=2020-01-01&to=2020-01-31', { token: TOKEN_ADMIN });
check('sin resultados: 200 con lista vacia, no error',
    vacio.estado === 200 && vacio.cuerpo.resultados.length === 0 && vacio.cuerpo.paginacion.total === 0);

const malos = await pedir('/api/logs?from=ayer&module=inventado&action_type=hackear&page_size=500&user_id=abc', { token: TOKEN_ADMIN });
const camposMalos = (malos.cuerpo.errores || []).map(e => e.campo).sort().join(',');
check('filtros invalidos: 400 con el detalle de cada campo',
    malos.estado === 400 && camposMalos === 'action_type,from,module,page_size,user_id', `(${camposMalos})`);

const alReves = await pedir('/api/logs?from=2026-03-05&to=2026-03-01', { token: TOKEN_ADMIN });
check('un rango al reves se rechaza', alReves.estado === 400);

const opciones = await pedir('/api/logs/filtros', { token: TOKEN_ADMIN });
check('las opciones de filtro traen modulos, acciones y usuarios',
    opciones.cuerpo.modulos.includes('reports') && opciones.cuerpo.acciones.includes('login_failed') &&
    opciones.cuerpo.usuarios.some(u => u.user_id === empleado));

// =====================================================================
console.log('\n--- DETALLE (criterio de aceptacion 3) ---');
// =====================================================================

const detalle = await pedir(`/api/logs/${logRol.id}`, { token: TOKEN_ADMIN });
check('el detalle responde 200', detalle.estado === 200);
check('trae valores anterior y nuevo', detalle.cuerpo.old_value?.role === 'instructor' && detalle.cuerpo.new_value?.role === 'admin');
check('trae IP de origen y trace_id', detalle.cuerpo.ip_address === '10.0.0.7' && detalle.cuerpo.trace_id === 'traza-de-prueba-01');

check('un id inexistente responde 404', (await pedir('/api/logs/99999999', { token: TOKEN_ADMIN })).estado === 404);
check('un id que no es numero responde 400', (await pedir('/api/logs/abc', { token: TOKEN_ADMIN })).estado === 400);

// =====================================================================
console.log('\n--- EXPORTACION CSV (criterio de aceptacion 4) ---');
// =====================================================================

const filtroExport = 'module=reports&from=2026-03-02&to=2026-03-02&order=asc';
const enPantalla = await pedir(`/api/logs?${filtroExport}&page_size=200`, { token: TOKEN_ADMIN });
const csv = await pedir(`/api/logs/export?${filtroExport}&page=2&page_size=3`, { token: TOKEN_ADMIN });

const lineas = String(csv.cuerpo).replace(/^\uFEFF/, '').split('\r\n');
check('responde un CSV', csv.estado === 200 && csv.headers.get('content-type').startsWith('text/csv'));
check('como archivo descargable', /attachment; filename="logs_auditoria_.*\.csv"/.test(csv.headers.get('content-disposition')));
// fetch().text() se come el BOM al decodificar: se mira en los bytes crudos.
const crudo = new Uint8Array(await (await fetch(`${BASE}/api/logs/export?${filtroExport}`,
    { headers: { Authorization: `Bearer ${TOKEN_ADMIN}` } })).arrayBuffer());
check('con BOM para que Excel respete las tildes', crudo[0] === 0xEF && crudo[1] === 0xBB && crudo[2] === 0xBF);
check('con encabezado', lineas[0].startsWith('id,fecha_hora_servidor,usuario'));
check('con exactamente las filas del filtro (todas las paginas, no la actual)',
    lineas.length - 1 === enPantalla.cuerpo.paginacion.total, `(${lineas.length - 1} vs ${enPantalla.cuerpo.paginacion.total})`);
check('en el mismo orden que la pantalla',
    lineas.slice(1).map(l => l.split(',')[0]).join() === enPantalla.cuerpo.resultados.map(r => String(r.id)).join());

await drenar();
const { rows: [logExport] } = await pg.query(
    `SELECT * FROM data.logs WHERE module = 'logs' AND action_type = 'export' ORDER BY id DESC LIMIT 1`);
check('la exportacion queda registrada en data.logs', !!logExport);
check('con los filtros usados y la cantidad de filas',
    logExport?.new_value?.filtros?.module === 'reports' && logExport?.new_value?.registros === 24);

const exportMalo = await pedir('/api/logs/export?action_type=nada', { token: TOKEN_ADMIN });
check('exportar con filtros invalidos responde 400, no un archivo', exportMalo.estado === 400);

// =====================================================================
console.log('\n--- RETENCION (criterio tecnico 6) ---');
// =====================================================================

const ahora = new Date('2026-09-22T12:00:00Z');
// Tres logs de hace mas de un anio y uno de hace 6 meses.
for (const [fecha, rid] of [['2025-01-10T00:00:00Z', 'viejo-1'], ['2025-05-20T00:00:00Z', 'viejo-2'],
                            ['2025-09-01T00:00:00Z', 'viejo-3'], ['2026-03-22T00:00:00Z', 'reciente']]) {
    const p = dataLogs.construirPayload({ accion: 'update', modulo: 'system', recurso: 'retencion', recursoId: rid, sistema: true });
    p.occurredAt = fecha;
    await dataLogs.persistir(p);
}

// La siembra de marzo 2026 (120 logs) queda dentro de los 12 meses.
const totalAntes = await contar('SELECT COUNT(*) AS n FROM data.logs');
const purga = await dataLogs.aplicarRetencion({ meses: 12, ahora });

check('la purga elimina solo lo que supera el periodo', purga.eliminados === 3, `(${purga.eliminados})`);
check('lo reciente sigue ahi',
    await contar(`SELECT COUNT(*) AS n FROM data.logs WHERE resource_type = 'retencion'`) === 1);
check('el total baja exactamente en lo purgado',
    await contar('SELECT COUNT(*) AS n FROM data.logs') === totalAntes - 3);

const [evidencia] = await dataLogs.listarPurgas();
check('queda evidencia en el log de sistema separado', !!evidencia);
check('con la cantidad y el rango de fechas',
    evidencia.deleted_count === 3 &&
    new Date(evidencia.oldest_deleted).toISOString() === '2025-01-10T00:00:00.000Z' &&
    new Date(evidencia.newest_deleted).toISOString() === '2025-09-01T00:00:00.000Z');
check('y con la politica y el corte aplicados',
    evidencia.retention_months === 12 && new Date(evidencia.cutoff).toISOString() === '2025-09-22T12:00:00.000Z');

let errDeleteTrasPurga = null;
try { await pg.query('DELETE FROM data.logs WHERE id = $1', [cualquiera.id]); } catch (e) { errDeleteTrasPurga = e; }
check('despues de la purga el DELETE manual vuelve a estar bloqueado', !!errDeleteTrasPurga);

let errEvidencia = null;
try { await pg.query('DELETE FROM data.logs_purges'); } catch (e) { errEvidencia = e; }
check('la evidencia de la purga no se puede borrar', !!errEvidencia);

const segunda = await dataLogs.aplicarRetencion({ meses: 12, ahora });
check('una segunda corrida sin nada que purgar no deja evidencia vacia',
    segunda.eliminados === 0 && (await dataLogs.listarPurgas()).length === 1);

let errMeses = null;
try { await dataLogs.aplicarRetencion({ meses: 0 }); } catch (e) { errMeses = e; }
check('un periodo de retencion invalido se rechaza', !!errMeses);

// =====================================================================
console.log('\n--- COLA Y CONEXIONES ---');
// =====================================================================

await drenar();
const estado = await eventBus.estadoDeLaCola();
check('no quedaron eventos de log fallidos', estado.por_estado.failed === 0, JSON.stringify(estado.por_estado));
check('no se filtraron conexiones del pool', conexionesAbiertas === 0, `(quedaron ${conexionesAbiertas})`);

servidor.close();
console.log(`\n${ok} OK, ${fallos} fallas`);
process.exit(fallos === 0 ? 0 : 1);
