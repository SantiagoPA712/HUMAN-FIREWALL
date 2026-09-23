/**
 * Pruebas de la HU de invitaciones de usuarios.
 *
 * Lo que se verifica:
 *
 *   - que invitar encole el correo con un enlace, y que en la base quede solo
 *     el hash del token (aceptacion 1, tecnico 1),
 *   - duplicados: 409 con el estado actual, y el indice que cubre las
 *     carreras entre dos pedidos (tecnico 3),
 *   - completar el registro: cuenta activa con el rol de la invitacion, token
 *     quemado, y ninguna cuenta si algo falla (aceptacion 2, tecnico 2),
 *   - enlace vencido: mensaje y pedido de reenvio (aceptacion 3),
 *   - reenviar con enlace nuevo que invalida el anterior, y cancelar
 *     (aceptacion 4),
 *   - el historial de cada cambio de estado y su registro en data.logs
 *     (tecnico 4),
 *   - que las rutas de admin se corten en el middleware y que las publicas
 *     tengan limite de pedidos.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';
import { createHash } from 'node:crypto';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';
process.env.JWT_EXPIRES = '1h';
process.env.APP_BASE_URL = 'https://hf.test';
delete process.env.SMTP_HOST;
delete process.env.INVITATION_EXPIRY_HOURS;

const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const msg = e => e?.message || String(e);

const adapter = {
    query: (t, p) => pg.query(t, p),
    connect: async () => ({ query: (t, p) => pg.query(t, p), release: () => {} })
};
const dbPath = require_.resolve('./config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
for (const archivo of readdirSync(`${DIR}migrations`).filter(f => f.endsWith('.sql')).sort()) {
    try { await pg.exec(readFileSync(`${DIR}migrations/${archivo}`, 'utf8')); }
    catch (e) { console.log(`ERROR en ${archivo}: ${msg(e)}`); fallos++; }
}
console.log('Esquema y migraciones listos\n');

const controller = require_('./controllers/invitations.controller');
const invitaciones = require_('./services/invitations.service');
const correo = require_('./services/emailNotifications.service');
const eventBus = require_('./services/eventBus');
const catalogo = require_('./events/catalogo');
const suscriptores = require_('./events/suscriptores');
const app = require_('./app');
const jwt = require_('jsonwebtoken');
const bcrypt = require_('bcrypt');

const suscritos = suscriptores.conectarTodo({ iniciarWorker: false });

const proveedor = { enviados: [], async sendMail(m) { this.enviados.push(m); return {}; } };
correo.usarTransporte(proveedor);

const llamar = async (handler, req) => {
    let estado = 200, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return { estado, cuerpo };
};

const { rows: [admin] } = await pg.query(`SELECT id, email FROM users WHERE email = 'admin@humanfirewall.com'`);
const comoAdmin = { user: { id: admin.id, role: 'admin' } };

const invitar = (body) => llamar(controller.invitar, { ...comoAdmin, body });
const validar = (token) => llamar(controller.validar, { body: { token } });
const aceptar = (token, datos) => llamar(controller.aceptar, { body: { token, ...datos } });
const pedirReenvio = (token) => llamar(controller.solicitarReenvio, { body: { token } });
const reenviar = (id) => llamar(controller.reenviar, { ...comoAdmin, params: { id: String(id) } });
const cancelar = (id) => llamar(controller.cancelar, { ...comoAdmin, params: { id: String(id) } });

const sha256 = t => createHash('sha256').update(t).digest('hex');

/** Procesa la cola de eventos y devuelve el token del ultimo correo de invitacion a `email`. */
async function tokenDelCorreo(email) {
    await eventBus.procesarPendientes();
    const { rows } = await pg.query(
        `SELECT body_text FROM email_jobs
          WHERE notification_type = 'user_invitation' AND to_email = $1
          ORDER BY id DESC LIMIT 1`,
        [email]
    );
    return rows[0]?.body_text.match(/invitacion\?token=([A-Za-z0-9_-]+)/)?.[1] || null;
}

const invitacionDe = async (email) => (await pg.query(
    `SELECT * FROM user_invitations WHERE email = $1 ORDER BY id DESC LIMIT 1`, [email]
)).rows[0];

const eventosDe = async (id) => (await pg.query(
    `SELECT action, actor_user_id, invited_by, email, role, occurred_at
       FROM user_invitation_events WHERE invitation_id = $1 ORDER BY id`, [id]
)).rows;

const contarUsuarios = async (email) => (await pg.query(
    'SELECT COUNT(*)::int AS n FROM users WHERE lower(email) = $1', [email]
)).rows[0].n;

// =====================================================================
console.log('--- CABLEADO ---');
// =====================================================================

check('user.invited esta en el catalogo y lo escucha el modulo de correo',
    catalogo.NOMBRES_VALIDOS.has('user.invited') && suscritos['user.invited'] === 1);

// =====================================================================
console.log('\n--- INVITAR (criterio de aceptacion 1, tecnico 1) ---');
// =====================================================================

const t0 = Date.now();
const r1 = await invitar({ email: '  Ana.Perez@HF.com ', role: 'employee' });
check('invitar responde 201', r1.estado === 201, `(${r1.estado} ${JSON.stringify(r1.cuerpo)})`);
check('en estado pendiente', r1.cuerpo?.estado === 'pendiente');
check('el correo se guarda normalizado', r1.cuerpo?.email === 'ana.perez@hf.com');
check('la respuesta no expone el token ni su hash',
    !JSON.stringify(r1.cuerpo).match(/token/i) && r1.cuerpo.token_hash === undefined);

const horas = (new Date(r1.cuerpo.expires_at) - t0) / 3600000;
check('vence a las 72 horas por defecto', horas > 71.9 && horas < 72.1, `(${horas.toFixed(2)} h)`);

check('el correo NO se envia dentro del request: queda un evento en la cola',
    proveedor.enviados.length === 0 &&
    (await pg.query(`SELECT 1 FROM event_outbox WHERE event_name = 'user.invited'`)).rows.length === 1);

const tokenAna = await tokenDelCorreo('ana.perez@hf.com');
const { rows: [jobAna] } = await pg.query(
    `SELECT * FROM email_jobs WHERE notification_type = 'user_invitation' AND to_email = 'ana.perez@hf.com'`
);
check('se encola el correo de invitacion, sin cuenta asociada todavia', jobAna && jobAna.user_id === null);
check('con el enlace absoluto para completar el registro',
    /https:\/\/hf\.test\/invitacion\?token=/.test(jobAna?.body_html || ''));
check('con el rol legible y quien invito',
    /Empleado/.test(jobAna?.body_text) && jobAna?.body_text.includes(admin.email), `(${jobAna?.body_text})`);

await correo.procesarPendientes();
check('el worker lo envia a la direccion invitada', proveedor.enviados.some(m => m.to === 'ana.perez@hf.com'));

const invAna = await invitacionDe('ana.perez@hf.com');
check('el token es criptograficamente largo (32 bytes)', tokenAna && tokenAna.length >= 43, `(${tokenAna})`);
check('en la base se guarda solo su SHA-256', invAna.token_hash === sha256(tokenAna));
check('y el token en claro no aparece en la fila', !JSON.stringify(invAna).includes(tokenAna));

const r2 = await invitar({ email: 'beto@hf.com', role: 'rh', language: 'en' });
const tokenBeto = await tokenDelCorreo('beto@hf.com');
check('cada invitacion tiene su propio token', tokenBeto && tokenBeto !== tokenAna);
const { rows: [jobBeto] } = await pg.query(
    `SELECT subject, body_text FROM email_jobs WHERE to_email = 'beto@hf.com'`
);
check('el correo sale en el idioma elegido para la invitacion',
    /^You are invited/.test(jobBeto?.subject) && /Human Resources/.test(jobBeto?.body_text));

process.env.INVITATION_EXPIRY_HOURS = '1';
const rCorta = await invitar({ email: 'corta@hf.com', role: 'instructor' });
delete process.env.INVITATION_EXPIRY_HOURS;
const horasCorta = (new Date(rCorta.cuerpo.expires_at) - Date.now()) / 3600000;
check('la vigencia es configurable (INVITATION_EXPIRY_HOURS)', horasCorta > 0.9 && horasCorta < 1.1, `(${horasCorta})`);

const malos = await invitar({ email: 'no-es-correo', role: 'admin', language: 'fr' });
check('datos invalidos: 400 con detalle por campo',
    malos.estado === 400 && malos.cuerpo.errores.map(e => e.campo).sort().join() === 'email,language,role');
check('no se puede invitar a un admin', malos.cuerpo.errores.some(e => e.campo === 'role'));

// =====================================================================
console.log('\n--- DUPLICADOS (criterio tecnico 3) ---');
// =====================================================================

const antesDup = (await pg.query('SELECT COUNT(*)::int AS n FROM user_invitations')).rows[0].n;

const dup = await invitar({ email: 'ANA.PEREZ@hf.com', role: 'rh' });
check('un correo con invitacion pendiente devuelve 409', dup.estado === 409);
check('con el estado actual', dup.cuerpo?.estado_actual === 'invitacion_pendiente' && dup.cuerpo?.invitacion_id === r1.cuerpo.id,
    `(${JSON.stringify(dup.cuerpo)})`);

const conCuenta = await invitar({ email: admin.email, role: 'employee' });
check('un correo con cuenta activa devuelve 409 cuenta_activa',
    conCuenta.estado === 409 && conCuenta.cuerpo.estado_actual === 'cuenta_activa');

await pg.exec(`INSERT INTO users (email, password, role, is_active) VALUES ('baja@hf.com', 'x', 'employee', false)`);
const inactiva = await invitar({ email: 'baja@hf.com', role: 'employee' });
check('una cuenta desactivada tambien bloquea, con su propio estado',
    inactiva.estado === 409 && inactiva.cuerpo.estado_actual === 'cuenta_inactiva');

check('ningun rechazo crea una invitacion',
    (await pg.query('SELECT COUNT(*)::int AS n FROM user_invitations')).rows[0].n === antesDup);

// Dos pedidos simultaneos no se pueden ejercitar aca: PGlite tiene UNA sola
// conexion, y dos transacciones a la vez se pisan entre si (25P02), cosa que
// en PostgreSQL real no pasa porque cada una toma su conexion del pool. Lo que
// si se verifica es la garantia de fondo: aunque dos pedidos pasaran el
// chequeo a la vez, la base no deja existir dos pendientes para un correo.
const doble = await invitar({ email: 'doble@hf.com', role: 'employee' });
let segundaPendiente = null;
try {
    await pg.exec(`INSERT INTO user_invitations (email, role, token_hash, expires_at)
                   VALUES ('doble@hf.com', 'employee', '${'f'.repeat(64)}', now() + interval '1 day')`);
} catch (e) { segundaPendiente = e; }
check('la base rechaza una segunda invitacion pendiente para el mismo correo (carreras)',
    doble.estado === 201 && segundaPendiente?.code === '23505', `(${segundaPendiente?.code})`);

// =====================================================================
console.log('\n--- COMPLETAR EL REGISTRO (criterio de aceptacion 2, tecnico 2) ---');
// =====================================================================

const v = await validar(tokenAna);
check('un enlace vigente muestra el formulario con correo y rol',
    v.estado === 200 && v.cuerpo.email === 'ana.perez@hf.com' && v.cuerpo.role === 'employee');

const inventado = await validar('A'.repeat(43));
check('un token inexistente se rechaza con 404', inventado.estado === 404 && inventado.cuerpo.motivo === 'invalida');
check('sin revelar ningun dato de invitaciones', inventado.cuerpo.email === undefined);
check('un token vacio o absurdo tambien', (await validar(undefined)).estado === 404 && (await validar('x')).estado === 404);

const debil = await aceptar(tokenAna, { password: 'corta', full_name: '' });
check('una contrasena debil o sin nombre devuelve 400 con detalle',
    debil.estado === 400 && debil.cuerpo.errores.length === 2);
check('y no crea la cuenta ni gasta el token',
    await contarUsuarios('ana.perez@hf.com') === 0 && (await invitacionDe('ana.perez@hf.com')).status === 'pending');

const acepto = await aceptar(tokenAna, { password: 'Segura123', full_name: '  Ana Perez ', language: 'es' });
check('completar el registro responde 201', acepto.estado === 201, `(${acepto.estado} ${JSON.stringify(acepto.cuerpo)})`);

const { rows: [cuentaAna] } = await pg.query(`SELECT * FROM users WHERE email = 'ana.perez@hf.com'`);
check('la cuenta queda activa', cuentaAna?.is_active === true);
check('con el rol que asigno el administrador', cuentaAna?.role === 'employee');
check('con los datos del perfil', cuentaAna?.full_name === 'Ana Perez' && cuentaAna?.language === 'es');
check('la contrasena se guarda hasheada', cuentaAna && cuentaAna.password !== 'Segura123' &&
    await bcrypt.compare('Segura123', cuentaAna.password));

const sesion = jwt.verify(acepto.cuerpo.token, process.env.JWT_SECRET);
check('devuelve una sesion lista para usar, con el rol asignado', sesion.id === cuentaAna.id && sesion.role === 'employee');

const invAceptada = await invitacionDe('ana.perez@hf.com');
check('la invitacion queda aceptada y apunta a la cuenta',
    invAceptada.status === 'accepted' && invAceptada.accepted_user_id === cuentaAna.id);

const { rows: [registrado] } = await pg.query(
    `SELECT payload FROM event_outbox WHERE event_name = 'user.registered' AND (payload->>'userId')::int = $1`, [cuentaAna.id]
);
check('publica user.registered como cualquier alta', registrado?.payload.provider === 'invitation');

const reuso = await aceptar(tokenAna, { password: 'OtraClave1', full_name: 'Intruso' });
check('el token no se puede usar dos veces (410)', reuso.estado === 410 && reuso.cuerpo.motivo === 'usada');
check('y no crea una segunda cuenta', await contarUsuarios('ana.perez@hf.com') === 1);
check('validar un token usado tampoco muestra el formulario', (await validar(tokenAna)).estado === 410);


// =====================================================================
console.log('\n--- ENLACE VENCIDO (criterio de aceptacion 3) ---');
// =====================================================================

await pg.exec(`UPDATE user_invitations SET expires_at = now() - interval '1 hour' WHERE email = 'beto@hf.com'`);

const vencida = await validar(tokenBeto);
check('un enlace vencido responde 410 con motivo expirada', vencida.estado === 410 && vencida.cuerpo.motivo === 'expirada');
check('con un mensaje que dice que vencio', /venci/i.test(vencida.cuerpo.msg));
check('y la opcion de pedir una nueva', vencida.cuerpo.puede_solicitar_reenvio === true);

const aceptarVencida = await aceptar(tokenBeto, { password: 'Segura123', full_name: 'Beto' });
check('no se puede completar el registro con un enlace vencido',
    aceptarVencida.estado === 410 && await contarUsuarios('beto@hf.com') === 0);

const invBeto = await invitacionDe('beto@hf.com');
check('la invitacion queda como expirada', invBeto.status === 'expired');
const expiroEv = (await eventosDe(invBeto.id)).find(e => e.action === 'expired');
check('y el historial registra el vencimiento a la hora en que vencio',
    expiroEv && new Date(expiroEv.occurred_at).getTime() === new Date(invBeto.expires_at).getTime());

const pedido = await pedirReenvio(tokenBeto);
check('el invitado puede pedir una nueva invitacion (202)', pedido.estado === 202 && pedido.cuerpo.ya_solicitado === false);
check('queda registrado el pedido', (await invitacionDe('beto@hf.com')).resend_requested_at !== null);

const { rows: avisoAdmin } = await pg.query(
    `SELECT title FROM notifications WHERE user_id = $1 AND event_name = 'user.invitation_resend_requested'`, [admin.id]
);
check('y le llega un aviso al admin que la genero', avisoAdmin.length === 1 && /beto@hf\.com/.test(avisoAdmin[0].title));

const pedido2 = await pedirReenvio(tokenBeto);
check('pedirlo de nuevo no duplica el aviso',
    pedido2.cuerpo.ya_solicitado === true &&
    (await pg.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE event_name = 'user.invitation_resend_requested'`)).rows[0].n === 1);

const vencidaEnPanel = await llamar(controller.validar, { body: { token: tokenBeto } });
check('la pantalla sabe que el reenvio ya fue pedido', vencidaEnPanel.cuerpo.reenvio_solicitado === true);

check('con un enlace vigente no hay reenvio que pedir (409)',
    (await pedirReenvio(await tokenDelCorreo('corta@hf.com'))).estado === 409);
check('con uno inventado, 404', (await pedirReenvio('B'.repeat(43))).estado === 404);

// =====================================================================
console.log('\n--- REENVIAR Y CANCELAR (criterio de aceptacion 4) ---');
// =====================================================================

const reenvio = await reenviar(r2.cuerpo.id);
check('el admin puede reenviar una invitacion vencida', reenvio.estado === 200 && reenvio.cuerpo.estado === 'pendiente',
    `(${reenvio.estado} ${JSON.stringify(reenvio.cuerpo)})`);
check('con un vencimiento nuevo y el pedido del invitado resuelto',
    new Date(reenvio.cuerpo.expires_at) > new Date() && reenvio.cuerpo.resend_requested_at === null &&
    reenvio.cuerpo.send_count === 2);

const tokenBeto2 = await tokenDelCorreo('beto@hf.com');
check('se manda un correo nuevo con un enlace distinto', tokenBeto2 && tokenBeto2 !== tokenBeto);
check('el enlace nuevo es valido', (await validar(tokenBeto2)).estado === 200);
check('y el anterior deja de existir', (await validar(tokenBeto)).estado === 404);

const tokenCorta = await tokenDelCorreo('corta@hf.com');
const reenvioPendiente = await reenviar(rCorta.cuerpo.id);
const tokenCorta2 = await tokenDelCorreo('corta@hf.com');
check('tambien se puede reenviar una pendiente, y el enlace viejo se invalida',
    reenvioPendiente.estado === 200 && tokenCorta2 !== tokenCorta &&
    (await validar(tokenCorta)).estado === 404 && (await validar(tokenCorta2)).estado === 200);

const reenviarAceptada = await reenviar(r1.cuerpo.id);
check('una invitacion aceptada no se reenvia (409)',
    reenviarAceptada.estado === 409 && reenviarAceptada.cuerpo.estado_actual === 'aceptada');

const cancelada = await cancelar(rCorta.cuerpo.id);
check('el admin puede cancelar una pendiente', cancelada.estado === 200 && cancelada.cuerpo.estado === 'cancelada');
const tras = await validar(tokenCorta2);
check('el enlace de una cancelada ya no sirve, y lo dice', tras.estado === 410 && tras.cuerpo.motivo === 'cancelada');
check('una cancelada no se vuelve a cancelar ni se reenvia',
    (await cancelar(rCorta.cuerpo.id)).estado === 409 && (await reenviar(rCorta.cuerpo.id)).estado === 409);
check('una aceptada no se cancela', (await cancelar(r1.cuerpo.id)).estado === 409);
check('un id inexistente devuelve 404', (await cancelar(999999)).estado === 404 && (await reenviar(999999)).estado === 404);

const reinvitar = await invitar({ email: 'corta@hf.com', role: 'employee' });
check('tras cancelar, el correo se puede volver a invitar', reinvitar.estado === 201);

// =====================================================================
console.log('\n--- PANEL (criterio de aceptacion 1) ---');
// =====================================================================

const panel = await llamar(controller.listar, { ...comoAdmin });
check('el panel lista las invitaciones con su estado', panel.estado === 200 &&
    panel.cuerpo.invitaciones.some(i => i.email === 'ana.perez@hf.com' && i.estado === 'aceptada'));
check('con el resumen por estado',
    panel.cuerpo.resumen.aceptada === 1 && panel.cuerpo.resumen.cancelada === 1 && panel.cuerpo.resumen.pendiente === 3,
    `(${JSON.stringify(panel.cuerpo.resumen)})`);
check('y el historial de cada una', panel.cuerpo.invitaciones.every(i => Array.isArray(i.historial) && i.historial.length >= 1));
check('sin exponer hashes de token', !JSON.stringify(panel.cuerpo).includes(invAna.token_hash));

await pg.exec(`UPDATE user_invitations SET expires_at = now() - interval '1 minute' WHERE email = 'doble@hf.com'`);
const soloVencidas = await llamar(controller.listar, { ...comoAdmin, query: { estado: 'expirada' } });
check('se puede filtrar por estado, y lo vencido aparece como expirada sin que nadie lo abra',
    soloVencidas.cuerpo.invitaciones.length === 1 && soloVencidas.cuerpo.invitaciones[0].email === 'doble@hf.com');
check('un estado invalido devuelve 400',
    (await llamar(controller.listar, { ...comoAdmin, query: { estado: 'rara' } })).estado === 400);

// =====================================================================
console.log('\n--- TRAZABILIDAD (criterio tecnico 4) ---');
// =====================================================================

const histAna = await eventosDe(r1.cuerpo.id);
check('creacion y aceptacion quedan en el historial',
    histAna.map(e => e.action).join() === 'created,accepted', `(${histAna.map(e => e.action)})`);
check('cada fila lleva admin que la genero, correo, rol y timestamp',
    histAna.every(e => e.invited_by === admin.id && e.email === 'ana.perez@hf.com' && e.role === 'employee' && e.occurred_at));
check('el actor de la creacion es el admin y el de la aceptacion la cuenta nueva',
    histAna[0].actor_user_id === admin.id && histAna[1].actor_user_id === cuentaAna.id);

const histBeto = (await eventosDe(r2.cuerpo.id)).map(e => e.action).join();
check('vencer, pedir reenvio y reenviar tambien quedan registrados',
    histBeto === 'created,expired,resend_requested,resent', `(${histBeto})`);
check('y cancelar', (await eventosDe(rCorta.cuerpo.id)).some(e => e.action === 'cancelled' && e.actor_user_id === admin.id));

let editado = null;
try { await pg.exec(`UPDATE user_invitation_events SET email = 'otro@hf.com'`); } catch (e) { editado = e; }
let borrado = null;
try { await pg.exec(`DELETE FROM user_invitation_events`); } catch (e) { borrado = e; }
check('el historial no se puede editar ni borrar', editado !== null && borrado !== null);

await eventBus.procesarPendientes();
const { rows: logs } = await pg.query(
    `SELECT action_type, user_id, new_value FROM data.logs
      WHERE resource_type = 'user_invitation' ORDER BY id`
);
const tiposLog = new Set(logs.map(l => l.action_type));
check('cada cambio llega tambien al log central (data.logs)',
    ['invite', 'invite_resend', 'invite_cancel', 'invite_accept'].every(t => tiposLog.has(t)), `(${[...tiposLog]})`);
check('con correo, rol y admin que la genero',
    logs.every(l => l.new_value.email && l.new_value.role && l.new_value.invited_by === admin.id));
check('la aceptacion la firma la cuenta nueva',
    logs.some(l => l.action_type === 'invite_accept' && l.user_id === cuentaAna.id));
check('ningun log guarda la contrasena elegida', !JSON.stringify(logs).includes('Segura123'));

// =====================================================================
console.log('\n--- HTTP: CONTROL DE ACCESO Y LIMITE ---');
// =====================================================================

const servidor = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${servidor.address().port}`;
const pedir = async (metodo, ruta, { token, body } = {}) => {
    const res = await fetch(base + ruta, {
        method: metodo,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    return { estado: res.status, cuerpo: await res.json().catch(() => null) };
};
const firmar = (id, role) => jwt.sign({ id, role }, process.env.JWT_SECRET);

check('listar sin sesion: 401', (await pedir('GET', '/api/invitations')).estado === 401);
check('un rol que no es admin no puede invitar: 403',
    (await pedir('POST', '/api/invitations', { token: firmar(cuentaAna.id, 'rh'), body: { email: 'x@hf.com', role: 'employee' } })).estado === 403);
check('el admin si', (await pedir('GET', '/api/invitations', { token: firmar(admin.id, 'admin') })).estado === 200);
check('validar funciona sin sesion', (await pedir('POST', '/api/invitations/validar', { body: { token: tokenBeto2 } })).estado === 200);

let limitado = false;
for (let i = 0; i < 40 && !limitado; i++) {
    limitado = (await pedir('POST', '/api/invitations/validar', { body: { token: 'C'.repeat(43) } })).estado === 429;
}
check('las rutas publicas tienen limite de pedidos: probar tokens en rafaga termina en 429', limitado);
servidor.close();

// =====================================================================
console.log(`\n${ok} OK, ${fallos} fallas`);
process.exit(fallos > 0 ? 1 : 0);
