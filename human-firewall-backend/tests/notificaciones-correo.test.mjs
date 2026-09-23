/**
 * Pruebas de la HU de notificaciones por correo.
 *
 * Lo que se verifica:
 *
 *   - que la operacion de origen responda sin esperar al correo, y que el
 *     correo sea un job aparte (criterio tecnico 1),
 *   - que el correo lleve el enlace a la seccion relevante (aceptacion 1),
 *   - plantillas por tipo e idioma, versionadas e inmutables (tecnico 2),
 *   - idioma de la cuenta y el de la plataforma como respaldo (aceptacion 3),
 *   - reintentos con backoff ante fallos transitorios y un registro por
 *     intento fallido; sin reintento ante errores permanentes (tecnico 3),
 *   - direccion invalida: no entregable, sin reintento y sin romper al
 *     modulo de origen (tecnico 4),
 *   - preferencias por tipo, criticos no desactivables (aceptacion 2, tecnico 5),
 *   - el reloj de fechas limite, el aviso de seguridad y la integracion con
 *     el canal de correo de la HU de resultados.
 *
 * El proveedor de correo es un doble: un objeto con sendMail() cuyo
 * comportamiento se programa en cada caso.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';
process.env.APP_BASE_URL = 'https://hf.test';
delete process.env.SMTP_HOST;
delete process.env.DEFAULT_LANGUAGE;

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

const correo = require_('./services/emailNotifications.service');
const plantillas = require_('./services/emailTemplates.service');
const resultados = require_('./services/resultNotifications.service');
const recovery = require_('./services/recovery.service');
const eventBus = require_('./services/eventBus');
const catalogo = require_('./events/catalogo');
const suscriptores = require_('./events/suscriptores');
const courseController = require_('./controllers/course.controller');
const emailController = require_('./controllers/emailNotifications.controller');
const userController = require_('./controllers/user.controller');

const { EVENTOS } = catalogo;
const suscritos = suscriptores.conectarTodo({ iniciarWorker: false });

const llamar = async (handler, req) => {
    let estado = 200, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return { estado, cuerpo };
};

/**
 * Proveedor de correo simulado. `programar` encola lo que van a hacer los
 * proximos envios: 'ok' o un error. Sin nada programado, acepta.
 */
const proveedor = {
    enviados: [],
    plan: [],
    programar(...pasos) { this.plan.push(...pasos); },
    reiniciar() { this.enviados = []; this.plan = []; },
    async sendMail(mensaje) {
        const paso = this.plan.shift() || 'ok';
        if (paso !== 'ok') throw paso;
        this.enviados.push(mensaje);
        return { messageId: `m${this.enviados.length}` };
    }
};
correo.usarTransporte(proveedor);

const errorDeRed = () => Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT', command: 'CONN' });
const error503 = () => Object.assign(new Error('Service unavailable'), { responseCode: 503, response: '503 try later' });
const errorPermanente = () => Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE', command: 'RCPT TO' });

const jobsDe = async (userId, tipo) => (await pg.query(
    `SELECT * FROM email_jobs WHERE user_id = $1 AND ($2::text IS NULL OR notification_type = $2) ORDER BY id`,
    [userId, tipo ?? null]
)).rows;

/** Adelanta los reintentos pendientes para no esperar el backoff real. */
const adelantarReintentos = () => pg.exec(
    `UPDATE email_jobs SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`
);

await pg.exec(`
  INSERT INTO users (email, password, role, language) VALUES
    ('ana@hf.com',     'x', 'employee', NULL),
    ('john@hf.com',    'x', 'employee', 'en'),
    ('roto@hf.com',    'x', 'employee', NULL),
    ('rh@hf.com',      'x', 'rh',       NULL);
  INSERT INTO courses (title) VALUES ('Phishing <avanzado> & mas'), ('Contrasenas seguras'), ('Wi-Fi');
`);
const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const cursoDe = async (titulo) => (await pg.query('SELECT id FROM courses WHERE title = $1', [titulo])).rows[0].id;

const ana = await idDe('ana@hf.com');
const john = await idDe('john@hf.com');
const rh = await idDe('rh@hf.com');
const phishing = await cursoDe('Phishing <avanzado> & mas');
const contrasenas = await cursoDe('Contrasenas seguras');
const wifi = await cursoDe('Wi-Fi');

// El usuario "roto" tiene un correo que no es un correo. La columna es UNIQUE
// y NOT NULL, asi que se rompe despues de crearlo, como pasaria con un dato
// migrado de otro sistema.
await pg.exec(`UPDATE users SET email = 'sin-arroba' WHERE email = 'roto@hf.com'`);
const roto = await idDe('sin-arroba');

// =====================================================================
console.log('--- CATALOGO Y CABLEADO ---');
// =====================================================================

for (const evento of ['course.assigned', 'course.deadline_approaching', 'user.password_changed']) {
    check(`${evento} esta en el catalogo y tiene suscriptor`,
        catalogo.NOMBRES_VALIDOS.has(evento) && suscritos[evento] === 1,
        `(suscriptores: ${suscritos[evento]})`);
}

const { rows: tipos } = await pg.query(
    'SELECT code, is_critical FROM email_notification_types ORDER BY code'
);
check('el catalogo distingue criticos de opcionales (tecnico 5)',
    tipos.some(t => t.is_critical) && tipos.some(t => !t.is_critical));
check('el aviso de cambio de contrasena es critico',
    tipos.find(t => t.code === 'security_password_changed')?.is_critical === true);

// =====================================================================
console.log('\n--- ASINCRONO Y DESACOPLADO (criterio tecnico 1) ---');
// =====================================================================

const asignacion = await llamar(courseController.assignCourse, {
    user: { id: rh, role: 'rh' },
    body: { course_id: phishing, user_id: ana, due_date: '2030-05-10T15:00:00Z' }
});
check('asignar un curso responde 201', asignacion.estado === 201, `(${asignacion.estado} ${JSON.stringify(asignacion.cuerpo)})`);
check('y guarda la fecha limite', asignacion.cuerpo?.due_date != null);

check('al responder, el correo todavia NO se envio', proveedor.enviados.length === 0);
check('ni siquiera esta encolado: solo existe el evento en el outbox',
    (await jobsDe(ana)).length === 0 &&
    (await pg.query(`SELECT 1 FROM event_outbox WHERE event_name = 'course.assigned'`)).rows.length === 1);

await eventBus.procesarPendientes();
let [jobAsignado] = await jobsDe(ana, 'course_assigned');
check('el handler del evento encola un job independiente', jobAsignado?.status === 'pending');
check('el job no se envia al encolarse: espera al worker', proveedor.enviados.length === 0);

// Un proveedor caido no afecta a la asignacion: el envio ni se intenta en el request.
proveedor.programar(errorDeRed(), errorDeRed(), errorDeRed(), errorDeRed(), errorDeRed());
const conProveedorCaido = await llamar(courseController.assignCourse, {
    user: { id: rh, role: 'rh' },
    body: { course_id: wifi, user_id: john }
});
check('con el proveedor caido, asignar un curso sigue respondiendo 201', conProveedorCaido.estado === 201);
proveedor.reiniciar();

const fechaInvalida = await llamar(courseController.assignCourse, {
    user: { id: rh, role: 'rh' },
    body: { course_id: contrasenas, user_id: ana, due_date: 'el martes' }
});
check('una fecha limite invalida devuelve 400 sin crear la asignacion',
    fechaInvalida.estado === 400 &&
    (await pg.query('SELECT 1 FROM course_assignments WHERE course_id = $1 AND user_id = $2', [contrasenas, ana])).rows.length === 0);

// =====================================================================
console.log('\n--- CONTENIDO Y ENLACE (criterio de aceptacion 1) ---');
// =====================================================================

let resumen = await correo.procesarPendientes();
check('el worker envia lo pendiente', resumen.enviados >= 1, `(${JSON.stringify(resumen)})`);

const mensajeAna = proveedor.enviados.find(m => m.to === 'ana@hf.com');
check('el correo va a la direccion del usuario', !!mensajeAna);
check('incluye el enlace directo a la seccion del curso',
    mensajeAna?.html.includes(`https://hf.test/dashboard?curso=${phishing}`) &&
    mensajeAna?.text.includes(`https://hf.test/dashboard?curso=${phishing}`));
check('y la fecha limite, formateada', /2030/.test(mensajeAna?.text || ''), `(${mensajeAna?.text})`);
check('los datos se escapan en el HTML (el titulo trae < y &)',
    mensajeAna?.html.includes('Phishing &lt;avanzado&gt; &amp; mas') && !mensajeAna?.html.includes('<avanzado>'));
check('el texto plano no se escapa', mensajeAna?.text.includes('Phishing <avanzado> & mas'));

[jobAsignado] = await jobsDe(ana, 'course_assigned');
check('el job queda como enviado con su fecha', jobAsignado.status === 'sent' && jobAsignado.sent_at != null);

const { rows: [tiempo] } = await pg.query(
    `SELECT EXTRACT(EPOCH FROM (sent_at - created_at)) AS seg FROM email_jobs WHERE id = $1`, [jobAsignado.id]
);
check('sin fallos, sale en la primera vuelta del worker', Number(tiempo.seg) < 60);

const peorCaso = Array.from({ length: correo.MAX_REINTENTOS }, (_, i) => correo.BACKOFF_BASE_SEGUNDOS * 2 ** i)
    .reduce((a, b) => a + b, 0);
check('aun agotando los reintentos, el backoff completo entra en 5 minutos', peorCaso < 300, `(${peorCaso}s)`);

// =====================================================================
console.log('\n--- PLANTILLAS VERSIONADAS (criterio tecnico 2) ---');
// =====================================================================

check('el job registra la plantilla y la version con que se armo',
    jobAsignado.template_id != null && jobAsignado.template_version === 1);

let editada = null;
try {
    await pg.exec(`UPDATE email_templates SET subject = 'otro' WHERE notification_type = 'course_assigned' AND language = 'es'`);
} catch (e) { editada = e; }
check('el contenido de una version publicada no se puede editar', editada !== null);

let borrada = null;
try { await pg.exec(`DELETE FROM email_templates WHERE notification_type = 'course_assigned'`); }
catch (e) { borrada = e; }
check('ni borrar', borrada !== null);

let dosActivas = null;
try {
    await pg.exec(`INSERT INTO email_templates (notification_type, language, version, subject, body_html, body_text)
                   VALUES ('course_assigned', 'es', 2, 's', 'h', 't')`);
} catch (e) { dosActivas = e; }
check('no puede haber dos versiones activas del mismo tipo e idioma', dosActivas !== null);

// Publicar la version 2 = desactivar la 1 e insertar la 2.
await pg.exec(`
  UPDATE email_templates SET is_active = false WHERE notification_type = 'course_assigned' AND language = 'es';
  INSERT INTO email_templates (notification_type, language, version, subject, body_html, body_text)
  VALUES ('course_assigned', 'es', 2, 'v2: {{curso}}', '<p>{{curso}} {{enlace}}</p>', '{{curso}} {{enlace}}');
`);
await correo.encolar({
    userId: ana, tipo: 'course_assigned', dedupeKey: 'prueba:v2',
    datos: { curso: 'Wi-Fi', ruta: '/dashboard' }
});
const [jobV2] = (await pg.query(`SELECT * FROM email_jobs WHERE dedupe_key = 'prueba:v2'`)).rows;
check('un correo nuevo usa la version activa', jobV2?.template_version === 2 && jobV2?.subject === 'v2: Wi-Fi');
check('y el ya enviado conserva el texto de la version 1',
    (await pg.query('SELECT subject FROM email_jobs WHERE id = $1', [jobAsignado.id])).rows[0].subject.startsWith('Nuevo curso'));

let faltaDato = null;
try {
    await correo.encolar({ userId: ana, tipo: 'course_assigned', dedupeKey: 'prueba:sin-dato', datos: { ruta: '/x' } });
} catch (e) { faltaDato = e; }
check('si la plantilla usa un dato que no vino, falla en vez de mandar un hueco',
    /curso/.test(msg(faltaDato)), `(${msg(faltaDato)})`);

check('un puntaje 0 se muestra: la seccion es por presencia, no por veracidad',
    plantillas.renderizar({ subject: '{{#p}}con {{p}}{{/p}}', body_html: '', body_text: '' }, { p: 0 }).subject === 'con 0');

// =====================================================================
console.log('\n--- IDIOMA (criterio de aceptacion 3) ---');
// =====================================================================

await eventBus.procesarPendientes();       // la asignacion de john
proveedor.reiniciar();
await correo.procesarPendientes();

const [jobJohn] = await jobsDe(john, 'course_assigned');
check('con idioma "en" en el perfil, el correo sale en ingles',
    jobJohn?.language === 'en' && /^New course assigned/.test(jobJohn?.subject), `(${jobJohn?.subject})`);
check('sin idioma configurado, sale en el de la plataforma (es)',
    jobAsignado.language === 'es' && /^Nuevo curso asignado/.test(jobAsignado.subject));

process.env.DEFAULT_LANGUAGE = 'en';
await correo.encolar({
    userId: ana, tipo: 'deadline_approaching', dedupeKey: 'prueba:default-en',
    datos: { curso: 'Wi-Fi', fechaLimite: '2030-01-01T12:00:00Z', ruta: '/dashboard' }
});
delete process.env.DEFAULT_LANGUAGE;
const [jobDefault] = (await pg.query(`SELECT language, subject FROM email_jobs WHERE dedupe_key = 'prueba:default-en'`)).rows;
check('si cambia el idioma por defecto, lo siguen quienes no eligieron uno',
    jobDefault?.language === 'en', `(${JSON.stringify(jobDefault)})`);

// Sin plantilla en el idioma del usuario: cae al de la plataforma.
await pg.exec(`UPDATE email_templates SET is_active = false WHERE notification_type = 'deadline_approaching' AND language = 'en'`);
await correo.encolar({
    userId: john, tipo: 'deadline_approaching', dedupeKey: 'prueba:fallback',
    datos: { curso: 'Wi-Fi', fechaLimite: '2030-01-01T12:00:00Z', ruta: '/dashboard' }
});
await pg.exec(`UPDATE email_templates SET is_active = true WHERE notification_type = 'deadline_approaching' AND language = 'en'`);
const [jobFallback] = (await pg.query(`SELECT language FROM email_jobs WHERE dedupe_key = 'prueba:fallback'`)).rows;
check('si falta la plantilla en su idioma, recibe la del idioma por defecto (y el job lo registra)',
    jobFallback?.language === 'es');

const idiomaMalo = await llamar(userController.updateMe, { user: { id: ana }, body: { language: 'fr' } });
check('el perfil rechaza un idioma fuera de catalogo', idiomaMalo.estado === 400);
const idiomaBien = await llamar(userController.updateMe, { user: { id: ana }, body: { language: 'en' } });
check('y acepta uno valido', idiomaBien.estado === 200 && idiomaBien.cuerpo.language === 'en');
await llamar(userController.updateMe, { user: { id: ana }, body: { language: null } });
check('null lo vuelve a "sin configurar"',
    (await pg.query('SELECT language FROM users WHERE id = $1', [ana])).rows[0].language === null);

// =====================================================================
console.log('\n--- REINTENTOS (criterio tecnico 3) ---');
// =====================================================================

// Se vacia la cola antes: los errores programados tienen que caerle al job
// de cada escenario y no a uno que quedo pendiente de una seccion anterior.
await correo.procesarPendientes();
proveedor.reiniciar();
const avisos = [];
const warnOriginal = console.warn;
console.warn = (...a) => { avisos.push(a.join(' ')); };

// Falla transitoria y despues exito.
proveedor.programar(error503(), 'ok');
await correo.encolar({ userId: ana, tipo: 'course_assigned', dedupeKey: 'prueba:transitorio',
    datos: { curso: 'Wi-Fi', ruta: '/dashboard' } });
await correo.procesarPendientes();

let [jobT] = (await pg.query(`SELECT * FROM email_jobs WHERE dedupe_key = 'prueba:transitorio'`)).rows;
check('un 5xx del proveedor deja el job pendiente para reintentar', jobT.status === 'pending' && jobT.attempts === 1);

const { rows: [espera1] } = await pg.query(
    `SELECT EXTRACT(EPOCH FROM (next_attempt_at - now())) AS seg FROM email_jobs WHERE id = $1`, [jobT.id]
);
check('con backoff: el reintento no es inmediato',
    Number(espera1.seg) > correo.BACKOFF_BASE_SEGUNDOS * 0.8, `(${espera1.seg}s)`);

await correo.procesarPendientes();
[jobT] = (await pg.query(`SELECT * FROM email_jobs WHERE id = $1`, [jobT.id])).rows;
check('antes de que venza la espera, el worker no lo toca', jobT.attempts === 1);

await adelantarReintentos();
await correo.procesarPendientes();
[jobT] = (await pg.query(`SELECT * FROM email_jobs WHERE id = $1`, [jobT.id])).rows;
check('al reintentar con el proveedor de vuelta, se envia', jobT.status === 'sent' && jobT.attempts === 2);

// Fallas transitorias sostenidas: se agota y queda fallido.
proveedor.programar(errorDeRed(), errorDeRed(), errorDeRed(), errorDeRed(), errorDeRed(), errorDeRed());
await correo.encolar({ userId: ana, tipo: 'course_assigned', dedupeKey: 'prueba:agotado',
    datos: { curso: 'Wi-Fi', ruta: '/dashboard' } });

const esperas = [];
for (let vuelta = 0; vuelta < 10; vuelta++) {
    await correo.procesarPendientes();
    const [j] = (await pg.query(
        `SELECT status, EXTRACT(EPOCH FROM (next_attempt_at - now())) AS seg
           FROM email_jobs WHERE dedupe_key = 'prueba:agotado'`
    )).rows;
    if (j.status !== 'pending') break;
    esperas.push(Number(j.seg));
    await adelantarReintentos();
}

let [jobA] = (await pg.query(`SELECT * FROM email_jobs WHERE dedupe_key = 'prueba:agotado'`)).rows;
check('con fallas transitorias sostenidas, termina marcado como fallido', jobA.status === 'failed');
check('el backoff es exponencial: cada espera es mayor que la anterior',
    esperas.length >= 2 && esperas.every((s, i) => i === 0 || s > esperas[i - 1] * 1.5),
    `(${esperas.map(s => Math.round(s)).join(', ')})`);
check('y guarda el ultimo error tecnico', /ETIMEDOUT/.test(jobA.last_error || ''));

const { rows: intentosA } = await pg.query(
    `SELECT attempt_no, outcome, error_code, error_detail FROM email_job_attempts WHERE job_id = $1 ORDER BY attempt_no`,
    [jobA.id]
);
check('cada intento fallido queda registrado',
    intentosA.length === jobA.attempts && intentosA.every(i => i.outcome === 'transient_error'),
    `(${intentosA.length} registros, ${jobA.attempts} intentos)`);
check('con el detalle tecnico del error', intentosA.every(i => /ETIMEDOUT/.test(i.error_detail) && /CONN/.test(i.error_detail)));
check('y cada intento fallido tambien sale en el log del servidor',
    avisos.filter(a => a.includes(`job ${jobA.id} (`) && a.includes('ETIMEDOUT')).length === jobA.attempts);

// Error permanente: sin reintento.
proveedor.reiniciar();
proveedor.programar(errorPermanente());
await correo.encolar({ userId: ana, tipo: 'course_assigned', dedupeKey: 'prueba:permanente',
    datos: { curso: 'Wi-Fi', ruta: '/dashboard' } });
await correo.procesarPendientes();
const [jobP] = (await pg.query(`SELECT * FROM email_jobs WHERE dedupe_key = 'prueba:permanente'`)).rows;
check('un error permanente (destinatario rechazado) no se reintenta', jobP.status === 'failed' && jobP.attempts === 1);
check('y queda registrado como permanente',
    (await pg.query(`SELECT outcome FROM email_job_attempts WHERE job_id = $1`, [jobP.id])).rows[0]?.outcome === 'permanent_error');

console.warn = warnOriginal;

check('clasificacion: timeout y 5xx son transitorios',
    correo.esErrorTransitorio({ code: 'ETIMEDOUT' }) && correo.esErrorTransitorio({ statusCode: 502 }));
check('clasificacion: un 4xx de cliente no lo es',
    !correo.esErrorTransitorio({ statusCode: 400 }) && !correo.esErrorTransitorio({ code: 'EENVELOPE' }));

// =====================================================================
console.log('\n--- DIRECCION INVALIDA (criterio tecnico 4) ---');
// =====================================================================

proveedor.reiniciar();
const alRoto = await llamar(courseController.assignCourse, {
    user: { id: rh, role: 'rh' },
    body: { course_id: contrasenas, user_id: roto }
});
check('asignar un curso a alguien sin correo valido responde 201 igual', alRoto.estado === 201);

await eventBus.procesarPendientes();
const { rows: [eventoRoto] } = await pg.query(
    `SELECT status FROM event_outbox WHERE event_name = 'course.assigned' AND (payload->>'userId')::int = $1`, [roto]
);
check('el evento se procesa sin error: no se interrumpe el flujo', eventoRoto?.status === 'done', `(${eventoRoto?.status})`);

const [jobRoto] = await jobsDe(roto);
check('se registra como no entregable', jobRoto?.status === 'undeliverable' && /correo valido/.test(jobRoto?.last_error || ''));
check('sin ningun intento de envio', jobRoto?.attempts === 0);

await correo.procesarPendientes();
check('el worker no lo toma: no se reintenta',
    (await jobsDe(roto))[0].attempts === 0 && !proveedor.enviados.some(m => m.to === 'sin-arroba'));

check('validacion: vacio, sin arroba y con espacios no son correos',
    !correo.esCorreoValido('') && !correo.esCorreoValido('ana.hf.com') &&
    !correo.esCorreoValido('ana @hf.com') && !correo.esCorreoValido(null) && correo.esCorreoValido('ana@hf.com'));

// =====================================================================
console.log('\n--- PREFERENCIAS (criterio de aceptacion 2, tecnico 5) ---');
// =====================================================================

const prefs = await llamar(emailController.getPreferencias, { user: { id: ana } });
check('las preferencias listan todos los tipos, habilitados por defecto',
    prefs.cuerpo.tipos.length === tipos.length && prefs.cuerpo.tipos.every(t => t.habilitado));
check('y marcan cuales son criticos',
    prefs.cuerpo.tipos.find(t => t.tipo === 'security_password_changed')?.critico === true);

const apagar = await llamar(emailController.patchPreferencias, {
    user: { id: ana }, body: { tipos: { course_assigned: false } }
});
check('se puede desactivar un tipo opcional',
    apagar.estado === 200 && apagar.cuerpo.tipos.find(t => t.tipo === 'course_assigned')?.habilitado === false);

const critico = await llamar(emailController.patchPreferencias, {
    user: { id: ana }, body: { tipos: { security_password_changed: false } }
});
check('desactivar un critico devuelve 400', critico.estado === 400, `(${critico.estado})`);
check('y no persiste nada',
    (await pg.query(`SELECT 1 FROM email_preferences WHERE user_id = $1 AND notification_type = 'security_password_changed'`, [ana])).rows.length === 0);

const invalido = await llamar(emailController.patchPreferencias, {
    user: { id: ana }, body: { tipos: { no_existe: false, course_assigned: 'no' } }
});
check('un tipo inexistente o un valor no booleano devuelven 400 con detalle por campo',
    invalido.estado === 400 && invalido.cuerpo.errores.length === 2);

const antes = (await jobsDe(ana)).length;
const omitido = await correo.encolar({ userId: ana, tipo: 'course_assigned', dedupeKey: 'prueba:omitido',
    datos: { curso: 'Wi-Fi', ruta: '/dashboard' } });
check('un tipo desactivado se omite antes de encolar', omitido.estado === 'omitido');
check('sin crear job ni registro de fallo', (await jobsDe(ana)).length === antes);

// La preferencia se respeta en envios futuros disparados por el flujo real.
await llamar(courseController.assignCourse, {
    user: { id: rh, role: 'rh' }, body: { course_id: contrasenas, user_id: ana }
});
await eventBus.procesarPendientes();
check('una asignacion posterior tampoco genera correo',
    (await jobsDe(ana, 'course_assigned')).every(j => !j.dedupe_key.startsWith('course_assigned:') || j.id === jobAsignado.id));

// El canal de correo entero apagado (preferencia de la HU de resultados).
await resultados.actualizarPreferencias(john, { email: false });
const sinCanal = await correo.encolar({ userId: john, tipo: 'deadline_approaching', dedupeKey: 'prueba:sin-canal',
    datos: { curso: 'Wi-Fi', fechaLimite: '2030-01-01T00:00:00Z', ruta: '/dashboard' } });
check('con el canal de correo apagado, un opcional tambien se omite', sinCanal.estado === 'omitido');

// Aunque exista una fila vieja que diga lo contrario, un critico sale igual.
await pg.exec(`INSERT INTO email_preferences (user_id, notification_type, enabled)
               VALUES (${john}, 'security_password_changed', false)`);
const criticoIgual = await correo.encolar({ userId: john, tipo: 'security_password_changed',
    dedupeKey: 'prueba:critico', datos: { fecha: new Date().toISOString(), ruta: '/forgot-password' } });
check('un critico sale aunque el canal y el tipo figuren apagados', criticoIgual.estado === 'encolado');
await resultados.actualizarPreferencias(john, { email: true });

// =====================================================================
console.log('\n--- AVISO DE SEGURIDAD (critico) ---');
// =====================================================================

await pg.exec(`INSERT INTO password_reset_tokens (user_id, token, expires_at)
               VALUES (${ana}, 'tok-1', now() + interval '1 hour')`);
await recovery.resetPassword('tok-1', 'NuevaClave1');
check('cambiar la contrasena publica user.password_changed',
    (await pg.query(`SELECT 1 FROM event_outbox WHERE event_name = 'user.password_changed'`)).rows.length === 1);

await eventBus.procesarPendientes();
const [jobSeg] = await jobsDe(ana, 'security_password_changed');
check('y encola el correo de seguridad', jobSeg?.status === 'pending');
check('con el enlace para recuperar la cuenta', jobSeg?.body_text.includes('https://hf.test/forgot-password'));

let fallo = null;
try { await recovery.resetPassword('tok-1', 'OtraClave1'); } catch (e) { fallo = e; }
check('un token ya usado no cambia nada ni publica otro aviso',
    fallo !== null &&
    (await pg.query(`SELECT COUNT(*)::int AS n FROM event_outbox WHERE event_name = 'user.password_changed'`)).rows[0].n === 1);

// =====================================================================
console.log('\n--- FECHA LIMITE PROXIMA ---');
// =====================================================================

await pg.exec(`
  UPDATE course_assignments SET due_date = now() + interval '20 hours' WHERE user_id = ${john} AND course_id = ${wifi};
  INSERT INTO course_assignments (course_id, user_id, status, due_date) VALUES
    (${contrasenas}, ${john}, 'assigned',  now() + interval '10 days'),
    (${phishing},    ${john}, 'completed', now() + interval '5 hours');
`);

const publicados = await correo.buscarVencimientosProximos();
check('detecta solo la asignacion abierta que vence dentro de la ventana', publicados === 1, `(${publicados})`);
check('una segunda pasada no vuelve a avisar', await correo.buscarVencimientosProximos() === 0);

await eventBus.procesarPendientes();
const [jobVence] = (await jobsDe(john, 'deadline_approaching')).filter(j => j.dedupe_key.startsWith('deadline:'));
check('el aviso de vencimiento se encola en el idioma del usuario',
    jobVence?.language === 'en' && /Due date approaching/.test(jobVence?.subject), `(${jobVence?.subject})`);

// =====================================================================
console.log('\n--- RESULTADOS DE EVALUACION (integracion con la HU de resultados) ---');
// =====================================================================

proveedor.reiniciar();
await eventBus.publish(EVENTOS.QUIZ_FAILED, {
    userId: john, quizRef: 'wifi', quizType: 'challenge', score: 0, passed: false,
    attemptId: 9001, attemptNo: 1, courseId: null
});
await eventBus.procesarPendientes();

const [jobRes] = await jobsDe(john, 'evaluation_result');
check('el resultado de una evaluacion encola su correo', !!jobRes);
check('armado con la plantilla, en el idioma del usuario',
    /^You did not pass: Wi-Fi Seguro/.test(jobRes?.subject), `(${jobRes?.subject})`);
check('un puntaje de 0 se informa', /score of 0/.test(jobRes?.body_text || ''), `(${jobRes?.body_text})`);
check('con el enlace para volver a intentarlo', jobRes?.body_html.includes('https://hf.test/challenges'));
check('y atado al aviso de la bandeja', jobRes?.notification_id != null);

const entregaEmail = async (notificationId) => (await pg.query(
    `SELECT status FROM notification_deliveries WHERE notification_id = $1 AND channel = 'email'`, [notificationId]
)).rows[0]?.status;

check('mientras espera al worker, la entrega por correo figura como generada',
    await entregaEmail(jobRes.notification_id) === 'generada');

await correo.procesarPendientes();
check('al enviarse, el worker la pasa a entregada', await entregaEmail(jobRes.notification_id) === 'entregada');

await llamar(emailController.patchPreferencias, {
    user: { id: john }, body: { tipos: { evaluation_result: false } }
});
await eventBus.publish(EVENTOS.QUIZ_APPROVED, {
    userId: john, quizRef: 'wifi', quizType: 'challenge', score: 90, passed: true, courseId: null
});
await eventBus.procesarPendientes();

const { rows: [avisoAprobado] } = await pg.query(
    `SELECT id FROM notifications WHERE user_id = $1 AND event_name = 'quiz.approved'`, [john]
);
check('con el tipo apagado, el aviso en la aplicacion llega igual', !!avisoAprobado);
check('pero no hay correo ni entrega registrada por ese canal',
    (await jobsDe(john, 'evaluation_result')).length === 1 && await entregaEmail(avisoAprobado.id) === undefined);

// =====================================================================
console.log('\n--- IDEMPOTENCIA Y DIAGNOSTICO ---');
// =====================================================================

const totalAntes = (await pg.query('SELECT COUNT(*)::int AS n FROM email_jobs')).rows[0].n;
const repetido = await correo.alAsignarCurso({ userId: john, courseId: wifi,
    assignmentId: jobJohn.dedupe_key.split(':')[1], dueDate: null });
check('reprocesar el mismo evento no encola un segundo correo',
    repetido.estado === 'duplicado' &&
    (await pg.query('SELECT COUNT(*)::int AS n FROM email_jobs')).rows[0].n === totalAntes);

const estado = await llamar(emailController.getEstado, { user: { id: rh, role: 'admin' } });
check('el diagnostico cuenta los jobs por estado',
    estado.cuerpo.por_estado.failed >= 2 && estado.cuerpo.por_estado.undeliverable >= 1);
check('y muestra los intentos de cada fallido',
    estado.cuerpo.ultimos_con_problemas.some(j => j.id === jobA.id && j.intentos.length === jobA.attempts));

// =====================================================================
console.log(`\n${ok} OK, ${fallos} fallas`);
process.exit(fallos > 0 ? 1 : 0);
