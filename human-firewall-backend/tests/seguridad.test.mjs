import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

// Mismo arranque que el resto: PostgreSQL real compilado a WebAssembly.
const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const msg = e => e?.message || String(e);

let conexionesAbiertas = 0;
const adapter = {
  query: (t, p) => pg.query(t, p),
  connect: async () => {
    conexionesAbiertas++;
    let devuelta = false;
    return {
      query: (t, p) => pg.query(t, p),
      release: () => { if (!devuelta) { devuelta = true; conexionesAbiertas--; } }
    };
  }
};
const dbPath = require_.resolve('./config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));

for (const f of ['001_points_ledger', '002_points_rules', '003_lesson_quiz_tracking',
                 '004_event_outbox', '005_rol_rh', '006_rewards_catalog', '007_user_rewards',
                 '008_desafios_faltantes', '009_notificaciones', '010_recomendaciones_precalculadas',
                 '020_levels_config', '021_user_level_history', '022_recommendation_rules',
                 '023_cursos_de_refuerzo', '024_simulacion_de_ejemplo', '025_equipos',
                 '026_exportaciones_de_reportes', '027_usuarios_iniciales',
                 '028_rol_seguridad', '029_anomalias', '030_audit_log']) {
  try { await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8')); }
  catch (e) { console.log(`ERROR en ${f}: ${msg(e)}`); fallos++; }
}
console.log('Migraciones aplicadas\n');

const eventBus = require_('./services/eventBus');
const points = require_('./services/points.service');
const anomalias = require_('./services/anomalies.service');
const auditoria = require_('./services/audit.service');
const controller = require_('./controllers/security.controller');
const { requireRoles } = require_('./middlewares/role.middleware');

points.registrarHandlers();
anomalias.registrarHandlers();

const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;

await pg.exec(`
  INSERT INTO users (email, password, role) VALUES
    ('sospechoso@hf.com', 'x', 'employee'),
    ('normal@hf.com',     'x', 'employee');
`);

const sospechoso = await idDe('sospechoso@hf.com');
const normal = await idDe('normal@hf.com');
const admin = await idDe('admin@humanfirewall.com');
const seguridad = await idDe('seguridad@humanfirewall.com');

/** Stubs de req/res para ejercitar los controladores reales. */
const llamar = async (handler, { body = {}, params = {}, query = {}, user } = {}) => {
    let estado = 200, cuerpo = null;
    const res = { status(c) { estado = c; return this; }, json(b) { cuerpo = b; return this; } };
    await handler({ body, params, query, user }, res);
    return { estado, cuerpo };
};

// ---------------------------------------------------------------------
console.log('--- ROL security Y CONTROL DE ACCESO (criterio tecnico 3) ---');

check('la cuenta de seguridad quedo creada por la migracion', !!seguridad);
const { rows: [rolSeg] } = await pg.query('SELECT role FROM users WHERE id = $1', [seguridad]);
check('con rol security', rolSeg.role === 'security');

// El CHECK de la migracion 005 no permitia este rol; 028 lo amplia.
let errRol = null;
try { await pg.query(`INSERT INTO users (email,password,role) VALUES ('x@hf.com','x','inventado')`); }
catch (e) { errRol = e; }
check('un rol fuera del catalogo se sigue rechazando', !!errRol);

const correrMiddleware = (rol) => {
    let estado = null, siguio = false;
    const res = { status(c) { estado = c; return this; }, json() { return this; } };
    requireRoles(['security', 'admin'])({ user: rol ? { id: 1, role: rol } : null }, res, () => { siguio = true; });
    return { estado, siguio };
};

check('un empleado recibe 403', correrMiddleware('employee').estado === 403);
check('rh tambien recibe 403: el panel no es suyo', correrMiddleware('rh').estado === 403);
check('sin autenticar recibe 401', correrMiddleware(null).estado === 401);
check('security pasa', correrMiddleware('security').siguio === true);
check('admin pasa', correrMiddleware('admin').siguio === true);

// Criterio tecnico 3: "sin ejecutar ninguna consulta".
let consultas = 0;
const queryOriginal = adapter.query;
adapter.query = (t, p) => { consultas++; return queryOriginal(t, p); };
correrMiddleware('employee');
adapter.query = queryOriginal;
check('el rechazo por rol no consulta la base', consultas === 0, `(hizo ${consultas})`);

// ---------------------------------------------------------------------
console.log('\n--- REGLAS CONFIGURABLES ---');

const reglas = await anomalias.obtenerReglas();
check('la migracion siembra dos umbrales', reglas.length === 2, `(hay ${reglas.length})`);
check('vienen ordenadas de mayor a menor umbral', reglas[0].max_points > reglas[1].max_points);
check('cada una define ventana, techo y severidad',
  reglas.every(r => r.window_minutes > 0 && r.max_points > 0 && r.severity));

let errUmbral = null;
try { await pg.query(`INSERT INTO anomaly_rules (code, window_minutes, max_points) VALUES ('mala', 0, 10)`); }
catch (e) { errUmbral = e; }
check('una ventana de cero minutos se rechaza', !!errUmbral);

// ---------------------------------------------------------------------
console.log('\n--- DETECCION EN TIEMPO REAL (criterio tecnico 1) ---');

// Puntos normales: por debajo de todos los umbrales.
await points.registrarMovimiento({
    userId: normal, sourceType: 'manual', sourceId: 'ok', points: 100,
    ruleCode: 'manual', idempotencyKey: `manual:${normal}:ok`
});
await eventBus.procesarPendientes();

const { rows: sinAlerta } = await pg.query('SELECT 1 FROM anomaly_events WHERE user_id = $1', [normal]);
check('un usuario dentro del umbral no genera alertas', sinAlerta.length === 0);

// Salto grande: supera los dos umbrales a la vez.
const movimiento = await points.registrarMovimiento({
    userId: sospechoso, sourceType: 'manual', sourceId: 'abuso', points: 2000,
    ruleCode: 'manual', idempotencyKey: `manual:${sospechoso}:abuso`
});

// Antes de drenar la cola no hay alerta: la deteccion es asincrona y no
// retrasa la accion que otorgo los puntos.
const { rows: antesDeDrenar } = await pg.query('SELECT 1 FROM anomaly_events WHERE user_id = $1', [sospechoso]);
check('la deteccion NO ocurre dentro de la accion que otorga los puntos', antesDeDrenar.length === 0);

await eventBus.procesarPendientes();

const { rows: alertas } = await pg.query(
    'SELECT rule_triggered, severity, status, source_id FROM anomaly_events WHERE user_id = $1 ORDER BY severity',
    [sospechoso]
);
check('tras drenar la cola aparecen las alertas', alertas.length === 2, `(hay ${alertas.length})`);
check('se disparan las dos reglas superadas',
  alertas.some(a => a.rule_triggered === 'tasa_alta') && alertas.some(a => a.rule_triggered === 'tasa_critica'));
check('nacen en estado pending', alertas.every(a => a.status === 'pending'));
check('con severidades distintas segun la regla',
  new Set(alertas.map(a => a.severity)).size === 2);
check('guardan el movimiento que las disparo',
  alertas.every(a => a.source_id === String(movimiento.id)));

// ---------------------------------------------------------------------
console.log('\n--- EVIDENCIA (criterio tecnico 2 / aceptacion 1) ---');

const { rows: [conEvidencia] } = await pg.query(
    `SELECT evidence FROM anomaly_events WHERE user_id = $1 AND rule_triggered = 'tasa_critica'`,
    [sospechoso]
);
const ev = conEvidencia.evidence;
check('la evidencia guarda el total y el umbral', ev.total_en_ventana === 2000 && ev.umbral === 1500);
check('y las referencias a points_ledger', Array.isArray(ev.movimientos) && ev.movimientos.length === 1);
check('con el ORIGEN de cada movimiento, no solo el id',
  ev.movimientos[0].origen === 'manual' && ev.movimientos[0].ledger_id === movimiento.id,
  `(${JSON.stringify(ev.movimientos[0])})`);

// ---------------------------------------------------------------------
console.log('\n--- INMUTABILIDAD (criterio tecnico 2) ---');

const { rows: [alerta] } = await pg.query(
    `SELECT id FROM anomaly_events WHERE user_id = $1 LIMIT 1`, [sospechoso]);

let errBorrado = null;
try { await pg.query('DELETE FROM anomaly_events WHERE id = $1', [alerta.id]); }
catch (e) { errBorrado = e; }
check('no se puede borrar una alerta', !!errBorrado);

let errEvidencia = null;
try { await pg.query(`UPDATE anomaly_events SET evidence = '[]'::jsonb WHERE id = $1`, [alerta.id]); }
catch (e) { errEvidencia = e; }
check('no se puede reescribir la evidencia', !!errEvidencia);

let errSeveridad = null;
try { await pg.query(`UPDATE anomaly_events SET severity = 'low' WHERE id = $1`, [alerta.id]); }
catch (e) { errSeveridad = e; }
check('no se puede rebajar la severidad', !!errSeveridad);

// El unico cambio permitido.
await pg.query(`UPDATE anomaly_events SET status = 'reviewed' WHERE id = $1`, [alerta.id]);
const { rows: [tras] } = await pg.query('SELECT status FROM anomaly_events WHERE id = $1', [alerta.id]);
check('SI se puede cambiar el status: es la excepcion que pide el criterio', tras.status === 'reviewed');
await pg.query(`UPDATE anomaly_events SET status = 'pending' WHERE id = $1`, [alerta.id]);

// ---------------------------------------------------------------------
console.log('\n--- CAMBIO DE ESTADO CON TRAZA (criterio tecnico 5) ---');

const invalido = await llamar(controller.updateAnomalyStatus, {
    params: { id: String(alerta.id) }, body: { status: 'cerrada' }, user: { id: seguridad, role: 'security' }
});
check('un estado fuera del catalogo se rechaza con 400', invalido.estado === 400);
check('y dice cuales son los validos', /pending, reviewed, dismissed/.test(invalido.cuerpo.errores[0].detalle));

const sinEstado = await llamar(controller.updateAnomalyStatus, {
    params: { id: String(alerta.id) }, body: {}, user: { id: seguridad, role: 'security' }
});
check('el estado es obligatorio', sinEstado.estado === 400);

await llamar(controller.updateAnomalyStatus, {
    params: { id: String(alerta.id) }, body: { status: 'reviewed', note: 'Revisado con el admin' },
    user: { id: seguridad, role: 'security' }
});
await llamar(controller.updateAnomalyStatus, {
    params: { id: String(alerta.id) }, body: { status: 'dismissed', note: 'Ajuste legitimo' },
    user: { id: seguridad, role: 'security' }
});

const { rows: historial } = await pg.query(
    'SELECT previous_status, new_status, changed_by, note FROM anomaly_status_history WHERE anomaly_id = $1 ORDER BY id',
    [alerta.id]
);
check('cada cambio deja una fila en el historial', historial.length === 2, `(hay ${historial.length})`);
check('el historial no sobrescribe: conserva la transicion anterior',
  historial[0].previous_status === 'pending' && historial[0].new_status === 'reviewed' &&
  historial[1].previous_status === 'reviewed' && historial[1].new_status === 'dismissed');
check('registra quien lo cambio', historial.every(h => h.changed_by === seguridad));
check('y la nota', historial[0].note === 'Revisado con el admin');

let errHistorial = null;
try { await pg.query(`UPDATE anomaly_status_history SET note = 'otra' WHERE anomaly_id = $1`, [alerta.id]); }
catch (e) { errHistorial = e; }
check('el historial de estados es inmutable', !!errHistorial);

const noExiste = await llamar(controller.updateAnomalyStatus, {
    params: { id: '99999' }, body: { status: 'reviewed' }, user: { id: seguridad, role: 'security' }
});
check('cambiar el estado de una alerta inexistente da 404', noExiste.estado === 404);

// ---------------------------------------------------------------------
console.log('\n--- AJUSTE MANUAL Y AUDITORIA (criterio tecnico 4) ---');

const sinMotivo = await llamar(controller.adjustUser, {
    params: { id: String(normal) }, body: { change_type: 'points', value: 500 },
    user: { id: admin, role: 'admin' }
});
check('sin reason responde 400', sinMotivo.estado === 400);
check('y senala el campo', sinMotivo.cuerpo.errores.some(e => e.campo === 'reason'));

const motivoVacio = await llamar(controller.adjustUser, {
    params: { id: String(normal) }, body: { change_type: 'points', value: 500, reason: '   ' },
    user: { id: admin, role: 'admin' }
});
check('un motivo en blanco tampoco vale', motivoVacio.estado === 400);

// Lo mas importante del criterio: el 400 NO debe haber ejecutado el ajuste.
const puntosTrasRechazo = await pg.query(
    'SELECT COALESCE(SUM(points),0)::int AS t FROM points_ledger WHERE user_id = $1', [normal]);
check('el ajuste rechazado NO se ejecuto', puntosTrasRechazo.rows[0].t === 100,
  `(tiene ${puntosTrasRechazo.rows[0].t} pts, deberia seguir en 100)`);

const conMotivo = await llamar(controller.adjustUser, {
    params: { id: String(normal) },
    body: { change_type: 'points', value: 500, reason: 'Compensacion por caida del sistema' },
    user: { id: admin, role: 'admin' }
});
check('con motivo se aplica', conMotivo.estado === 200);
check('devuelve el estado previo y el nuevo',
  conMotivo.cuerpo.estado_previo.puntos === 100 && conMotivo.cuerpo.estado_nuevo.puntos === 600);

const { rows: [registro] } = await pg.query(
    `SELECT actor_id, target_user_id, change_type, previous_value, new_value, reason
       FROM audit_log ORDER BY id DESC LIMIT 1`);
check('queda en audit_log con actor y objetivo',
  registro.actor_id === admin && registro.target_user_id === normal);
check('con el tipo de cambio', registro.change_type === 'points');
check('con el valor anterior y el nuevo',
  registro.previous_value.puntos === 100 && registro.new_value.puntos === 600);
check('y con el motivo textual', registro.reason === 'Compensacion por caida del sistema');

let errAudit = null;
try { await pg.query(`UPDATE audit_log SET reason = 'otro' WHERE actor_id = $1`, [admin]); }
catch (e) { errAudit = e; }
check('audit_log es INSERT-only: no se puede editar', !!errAudit);

let errAuditDel = null;
try { await pg.query(`DELETE FROM audit_log WHERE actor_id = $1`, [admin]); }
catch (e) { errAuditDel = e; }
check('ni eliminar', !!errAuditDel);

let errSinMotivoBD = null;
try {
    await pg.query(
        `INSERT INTO audit_log (actor_id, change_type, reason) VALUES ($1, 'points', '')`, [admin]);
} catch (e) { errSinMotivoBD = e; }
check('la base tampoco acepta un motivo vacio, ni saltando el controlador', !!errSinMotivoBD);

// ---------------------------------------------------------------------
console.log('\n--- AJUSTE DE NIVEL: se traduce a puntos ---');

const nivelAntes = (await pg.query('SELECT level FROM users WHERE id = $1', [normal])).rows[0].level;

const ajusteNivel = await llamar(controller.adjustUser, {
    params: { id: String(normal) },
    body: { change_type: 'level', value: 4, reason: 'Reconocimiento por auditoria interna' },
    user: { id: admin, role: 'admin' }
});
check('ajustar el nivel se acepta', ajusteNivel.estado === 200, `(${JSON.stringify(ajusteNivel.cuerpo)})`);
check('y se materializa como puntos, no escribiendo users.level a mano',
  ajusteNivel.cuerpo.estado_nuevo.nivel === 4 && ajusteNivel.cuerpo.estado_nuevo.puntos >= 701,
  `(nivel ${ajusteNivel.cuerpo.estado_nuevo.nivel}, ${ajusteNivel.cuerpo.estado_nuevo.puntos} pts)`);

const nivelInexistente = await llamar(controller.adjustUser, {
    params: { id: String(normal) },
    body: { change_type: 'level', value: 99, reason: 'prueba' },
    user: { id: admin, role: 'admin' }
});
check('un nivel que no existe se rechaza', nivelInexistente.estado === 400);

// Bajar de nivel exigiria quitar puntos: se explica en vez de fallar raro.
const bajarNivel = await llamar(controller.adjustUser, {
    params: { id: String(normal) },
    body: { change_type: 'level', value: 1, reason: 'prueba' },
    user: { id: admin, role: 'admin' }
});
check('bajar de nivel se rechaza explicando como hacerlo', bajarNivel.estado === 400 &&
  /points.*negativ/i.test(bajarNivel.cuerpo.errores[0].detalle),
  `("${bajarNivel.cuerpo.errores[0]?.detalle}")`);

const tipoInvalido = await llamar(controller.adjustUser, {
    params: { id: String(normal) },
    body: { change_type: 'reputacion', value: 1, reason: 'prueba' },
    user: { id: admin, role: 'admin' }
});
check('un tipo de ajuste inventado se rechaza', tipoInvalido.estado === 400);

// ---------------------------------------------------------------------
console.log('\n--- JOB PERIODICO DE RESPALDO (criterio tecnico 6) ---');

const antesDelJob = (await pg.query('SELECT COUNT(*)::int n FROM anomaly_events')).rows[0].n;
const corrida1 = await anomalias.ejecutarJob();
const trasJob1 = (await pg.query('SELECT COUNT(*)::int n FROM anomaly_events')).rows[0].n;

check('el job recorre solo a los usuarios con movimientos recientes',
  corrida1.usuarios > 0 && corrida1.usuarios <= 3, `(reviso ${corrida1.usuarios})`);

const corrida2 = await anomalias.ejecutarJob();
const trasJob2 = (await pg.query('SELECT COUNT(*)::int n FROM anomaly_events')).rows[0].n;
check('reejecutarlo no duplica alertas (idempotencia por source_id + regla)',
  trasJob1 === trasJob2 && corrida2.detectadas === 0,
  `(${antesDelJob} -> ${trasJob1} -> ${trasJob2})`);

// El job es la red de seguridad: detecta lo que el evento no alcanzo a
// procesar. Se simula insertando en el ledger sin pasar por el bus.
await pg.query(
    `INSERT INTO points_ledger (user_id, source_type, source_id, points, rule_code, idempotency_key)
     VALUES ($1, 'manual', 'perdido', 5000, 'manual', $2)`,
    [normal, `manual:${normal}:perdido`]
);
const corrida3 = await anomalias.ejecutarJob();
check('el job detecta lo que el evento en tiempo real se perdio',
  corrida3.detectadas > 0, `(detecto ${corrida3.detectadas})`);

// ---------------------------------------------------------------------
console.log('\n--- PANEL Y LOG ---');

const panel = await llamar(controller.listAnomalies, { query: {}, user: { id: seguridad, role: 'security' } });
check('el panel lista las alertas', panel.cuerpo.resultados.length > 0);
check('con contadores por estado', typeof panel.cuerpo.resumen.pendientes === 'number');
check('las pendientes van primero', panel.cuerpo.resultados[0].status === 'pending');

const filtrado = await llamar(controller.listAnomalies, {
    query: { status: 'dismissed' }, user: { id: seguridad, role: 'security' }
});
check('se puede filtrar por estado',
  filtrado.cuerpo.resultados.every(a => a.status === 'dismissed'));

const estadoMalo = await llamar(controller.listAnomalies, {
    query: { status: 'inventado' }, user: { id: seguridad, role: 'security' }
});
check('un filtro de estado invalido da 400', estadoMalo.estado === 400);

const detalleAlerta = await llamar(controller.getAnomaly, {
    params: { id: String(alerta.id) }, user: { id: seguridad, role: 'security' }
});
check('el detalle trae la linea de tiempo del usuario',
  Array.isArray(detalleAlerta.cuerpo.linea_de_tiempo) && detalleAlerta.cuerpo.linea_de_tiempo.length > 0);
check('y el historial de estados', detalleAlerta.cuerpo.historial_estados.length === 2);

const log = await llamar(controller.listAuditLog, { query: {}, user: { id: seguridad, role: 'security' } });
check('el log de auditoria lista los ajustes', log.cuerpo.resultados.length >= 2);
check('con el correo del actor', log.cuerpo.resultados[0].actor_email === 'admin@humanfirewall.com');

const porTipo = await llamar(controller.listAuditLog, {
    query: { change_type: 'level' }, user: { id: seguridad, role: 'security' }
});
check('se puede filtrar por tipo de cambio',
  porTipo.cuerpo.resultados.length > 0 && porTipo.cuerpo.resultados.every(l => l.change_type === 'level'));

const porActor = await llamar(controller.listAuditLog, {
    query: { actor_id: String(admin) }, user: { id: seguridad, role: 'security' }
});
check('y por actor', porActor.cuerpo.resultados.every(l => l.actor_id === admin));

check('todas las conexiones se devolvieron al pool', conexionesAbiertas === 0, `(quedaron ${conexionesAbiertas})`);

console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
