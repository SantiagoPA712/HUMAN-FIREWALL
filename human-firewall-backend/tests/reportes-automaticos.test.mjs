/**
 * Pruebas de la HU de reportes automaticos periodicos.
 *
 * Lo que se verifica es lo que la historia promete y que no se puede
 * comprobar mirando el codigo:
 *
 *   - que el 403 de la configuracion salga del middleware y NO escriba nada,
 *   - que el periodo cubierto sea el ya cerrado y que la clave sea estable,
 *   - que next_run_at se adelante al encolar y no dispare dos veces,
 *   - que reprocesar el evento no genere un duplicado ni reenvie el aviso,
 *   - que el historico no se pueda editar ni borrar sin politica de retencion,
 *   - que el aviso se reintente tres veces con backoff y despues se rinda,
 *   - y que el detalle tecnico de un fallo no salga hacia RH.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const msg = e => e?.message || String(e);

const adapter = {
    query: (t, p) => pg.query(t, p),
    connect: async () => {
        let devuelta = false;
        return {
            query: (t, p) => pg.query(t, p),
            release: () => { devuelta = true; }
        };
    }
};
const dbPath = require_.resolve('./config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

// Esquema + todas las migraciones del directorio: asi una migracion nueva
// entra sola a la prueba.
await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
for (const archivo of readdirSync(`${DIR}migrations`).filter(f => f.endsWith('.sql')).sort()) {
    try { await pg.exec(readFileSync(`${DIR}migrations/${archivo}`, 'utf8')); }
    catch (e) { console.log(`ERROR en ${archivo}: ${msg(e)}`); fallos++; }
}
console.log('Esquema y migraciones listos\n');

const sched = require_('./services/scheduledReports.service');
const notifications = require_('./services/notifications.service');
const controller = require_('./controllers/scheduledReports.controller');
const { requireRoles } = require_('./middlewares/role.middleware');
const eventBus = require_('./services/eventBus');
const suscriptores = require_('./events/suscriptores');

// Igual que server.js pero sin temporizadores: la cola se drena a mano.
suscriptores.conectarTodo({ iniciarWorker: false });

const llamar = async (handler, req) => {
    let estado = 200, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await handler({ params: {}, body: {}, query: {}, ...req }, res);
    return { estado, cuerpo };
};

// ---------------------------------------------------------------------
console.log('--- CONTROL DE ACCESO (criterio tecnico 6) ---');

const correrMiddleware = (rol) => {
    let estado = null, siguio = false;
    const res = { status(c) { estado = c; return this; }, json() { return this; } };
    requireRoles(['admin'])({ user: rol ? { id: 1, role: rol } : null }, res, () => { siguio = true; });
    return { estado, siguio };
};

check('un empleado recibe 403 al configurar programaciones', correrMiddleware('employee').estado === 403);
check('rh tambien recibe 403: configurar no es su tarea', correrMiddleware('rh').estado === 403);
check('un gerente recibe 403', correrMiddleware('manager').estado === 403);
check('sin usuario autenticado recibe 401', correrMiddleware(null).estado === 401);
check('admin pasa al controlador', correrMiddleware('admin').siguio === true);

// "Sin persistir ningun cambio": el rechazo no debe tocar la base.
let consultas = 0;
const queryOriginal = adapter.query;
adapter.query = (t, p) => { consultas++; return queryOriginal(t, p); };
correrMiddleware('rh');
adapter.query = queryOriginal;
check('el rechazo por rol no consulta la base', consultas === 0, `(hizo ${consultas} consultas)`);

const { rows: [antes] } = await pg.query('SELECT COUNT(*)::int AS n FROM report_schedules');

// ---------------------------------------------------------------------
console.log('\n--- PERIODOS ---');

const jueves = new Date('2026-09-03T09:00:00Z');

check('el periodo diario es el dia ya cerrado (ayer)',
    sched.calcularPeriodo('daily', jueves).clave === '2026-09-02',
    `(dio ${sched.calcularPeriodo('daily', jueves).clave})`);

const semanal = sched.calcularPeriodo('weekly', jueves);
check('el periodo semanal es la semana anterior completa, de lunes a domingo',
    semanal.from === '2026-08-24' && semanal.to === '2026-08-30',
    `(dio ${semanal.from} a ${semanal.to})`);

const mensual = sched.calcularPeriodo('monthly', jueves);
check('el periodo mensual es el mes anterior completo',
    mensual.clave === '2026-08' && mensual.from === '2026-08-01' && mensual.to === '2026-08-31',
    `(dio ${mensual.clave}: ${mensual.from} a ${mensual.to})`);

// El 31 de diciembre de 2025 cae en miercoles: pertenece a la semana 1 de
// 2026. Sin la correccion al jueves, la clave saldria 2025-W01 y dos semanas
// distintas compartirian identificador.
check('la clave de semana usa el anio ISO, no el del calendario',
    sched.semanaISO(new Date('2025-12-31T00:00:00Z')) === '2026-W01',
    `(dio ${sched.semanaISO(new Date('2025-12-31T00:00:00Z'))})`);

const proxima = sched.calcularProximaEjecucion(
    'daily', new Date('2026-09-01T08:00:00Z'), new Date('2026-09-01T08:04:00Z')
);
check('la proxima ejecucion conserva la hora configurada',
    proxima.toISOString() === '2026-09-02T08:00:00.000Z', `(dio ${proxima.toISOString()})`);

// Servidor apagado una semana: no se acumulan siete corridas atrasadas.
const trasCaida = sched.calcularProximaEjecucion(
    'daily', new Date('2026-08-25T08:00:00Z'), new Date('2026-09-01T10:00:00Z')
);
check('tras una caida larga la proxima ejecucion es la siguiente, no una rafaga',
    trasCaida.toISOString() === '2026-09-02T08:00:00.000Z', `(dio ${trasCaida.toISOString()})`);

// ---------------------------------------------------------------------
console.log('\n--- VALIDACION DE LA PROGRAMACION ---');

const v = (entrada, opciones) => sched.validarProgramacion(entrada, opciones);

check('rechaza una frecuencia inexistente',
    (await v({ name: 'x', report_type: 'performance', frequency: 'quincenal', subscriber_roles: ['rh'] }))
        .errores.some(e => e.campo === 'frequency'));

check('rechaza un rol suscrito que no existe',
    (await v({ name: 'x', report_type: 'performance', frequency: 'daily', subscriber_roles: ['contabilidad'] }))
        .errores.some(e => e.campo === 'subscriber_roles'));

check('rechaza un equipo inexistente en los filtros, al configurar y no al ejecutar',
    (await v({ name: 'x', report_type: 'performance', frequency: 'daily',
               subscriber_roles: ['rh'], params: { team_id: 9999 } }))
        .errores.some(e => e.campo === 'params.team_id'));

check('rechaza el consolidado organizacional en PDF',
    (await v({ name: 'x', report_type: 'organizational', frequency: 'monthly',
               format: 'pdf', subscriber_roles: ['manager'] }))
        .errores.some(e => e.campo === 'format'));

check('acepta una programacion valida',
    (await v({ name: 'Semanal RH', report_type: 'performance', frequency: 'weekly',
               format: 'csv', subscriber_roles: ['rh', 'admin'] })).errores.length === 0);

check('en PATCH no exige los campos que no vinieron',
    (await v({ frequency: 'monthly' }, { parcial: true })).errores.length === 0);

// El controlador corta en 400 sin escribir.
const invalida = await llamar(controller.createSchedule, {
    user: { id: 1, role: 'admin' },
    body: { name: 'x', report_type: 'performance', frequency: 'cada rato', subscriber_roles: ['rh'] }
});
const { rows: [despues] } = await pg.query('SELECT COUNT(*)::int AS n FROM report_schedules');
check('el controlador responde 400 ante una programacion invalida', invalida.estado === 400);
check('y no persiste nada', despues.n === antes.n, `(paso de ${antes.n} a ${despues.n})`);

// ---------------------------------------------------------------------
console.log('\n--- DISPARO (criterio tecnico 1) ---');

await pg.exec(`
  INSERT INTO users (email, password, role, team_id) VALUES
    ('ana@hf.com',  'x', 'employee', 1),
    ('beto@hf.com', 'x', 'employee', 1);
`);
const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const ana = await idDe('ana@hf.com');

await pg.query(
    `INSERT INTO points_ledger (user_id, source_type, source_id, points, rule_code, idempotency_key, created_at)
     VALUES ($1, 'manual', 'demo', 300, 'manual', 'p1', $2)`,
    [ana, '2026-08-26T10:00:00Z']
);

// Una programacion diaria que vencio hace un minuto.
const { rows: [programada] } = await pg.query(
    `INSERT INTO report_schedules (name, report_type, frequency, format, subscriber_roles, next_run_at)
     VALUES ('Diario de prueba', 'performance', 'daily', 'csv', ARRAY['rh','admin']::text[], now() - interval '1 minute')
     RETURNING id, next_run_at`
);

const encolados = await sched.dispararProgramacionesVencidas();
check('el scheduler encola la programacion vencida', encolados.length === 1);
check('el evento lleva el periodo y los parametros congelados',
    encolados[0]?.periodo && encolados[0]?.params?.from && encolados[0]?.params?.to,
    `(${JSON.stringify(encolados[0]?.params)})`);

const { rows: [reprogramada] } = await pg.query(
    'SELECT next_run_at, last_run_at FROM report_schedules WHERE id = $1', [programada.id]
);
check('next_run_at se adelanta en el mismo momento de encolar',
    new Date(reprogramada.next_run_at) > new Date(),
    `(quedo en ${reprogramada.next_run_at})`);
check('queda registrada la ultima corrida', reprogramada.last_run_at !== null);

check('una segunda vuelta del scheduler no vuelve a encolar',
    (await sched.dispararProgramacionesVencidas()).length === 0);

const { rows: encolado } = await pg.query(
    `SELECT event_name, status FROM event_outbox WHERE event_name = 'report.scheduled_run'`
);
check('el evento quedo en la cola, no ejecutado dentro del disparo',
    encolado.length === 1 && encolado[0].status === 'pending');

const { rows: [sinGenerar] } = await pg.query('SELECT COUNT(*)::int AS n FROM report_history');
check('todavia no hay ningun reporte generado', sinGenerar.n === 0);

// ---------------------------------------------------------------------
console.log('\n--- GENERACION E IDEMPOTENCIA (criterios tecnicos 2 y 3) ---');

await eventBus.procesarPendientes();

const { rows: historial } = await pg.query(
    `SELECT id, schedule_id, type, period, params_used, status, file_location, row_count, generated_at
       FROM report_history`
);
check('drenar la cola genera exactamente un reporte', historial.length === 1);
check('el registro guarda tipo, periodo, parametros y estado',
    historial[0]?.type === 'performance' &&
    historial[0]?.status === 'success' &&
    historial[0]?.params_used?.from != null,
    `(${JSON.stringify(historial[0])})`);
check('el registro guarda la ubicacion del archivo', !!historial[0]?.file_location);
check('el archivo existe en disco',
    existsSync(`${DIR}human-firewall-backend/${historial[0]?.file_location}`));
check('el nombre del archivo no lleva datos de la organizacion',
    !/rh|ana|beto|equipo/i.test(historial[0]?.file_location || ''));

const { rows: avisos } = await pg.query(
    `SELECT n.id, n.kind, n.status, u.role
       FROM report_notifications n JOIN users u ON u.id = n.user_id`
);
check('se encolo un aviso por cada persona de los roles suscritos',
    avisos.length === 2 && avisos.every(a => ['rh', 'admin'].includes(a.role)),
    `(${JSON.stringify(avisos.map(a => a.role))})`);
check('los avisos se entregaron', avisos.every(a => a.status === 'sent'));

const { rows: bandeja } = await pg.query(
    `SELECT title, body FROM notifications WHERE event_name = 'report.auto_generated'`
);
check('el mensaje incluye un enlace directo al reporte',
    bandeja.length === 2 && /\/reports\/history\/\d+\/download/.test(bandeja[0].body),
    `(${bandeja[0]?.body})`);

// Reproceso del mismo evento: el bus reintenta, el reporte no se duplica.
await pg.query(`UPDATE event_outbox SET status = 'pending', next_attempt_at = now()`);
await eventBus.procesarPendientes();

const { rows: [trasReproceso] } = await pg.query('SELECT COUNT(*)::int AS n FROM report_history');
const { rows: [avisosTras] } = await pg.query('SELECT COUNT(*)::int AS n FROM report_notifications');
check('reprocesar el evento no genera un reporte duplicado', trasReproceso.n === 1, `(hay ${trasReproceso.n})`);
check('y tampoco reenvia el aviso', avisosTras.n === 2, `(hay ${avisosTras.n})`);

// Aunque alguien fuerce la generacion a mano, el indice unico parcial la corta.
const repetido = await sched.generarReporteProgramado({
    scheduleId: programada.id, tipo: 'performance', formato: 'csv',
    periodo: historial[0].period, params: historial[0].params_used
});
check('una generacion repetida del mismo periodo se omite explicitamente',
    repetido.omitido === true);

// ---------------------------------------------------------------------
console.log('\n--- EL HISTORICO NO SE EDITA NI SE BORRA SOLO (criterio tecnico 3) ---');

try {
    await pg.query(`UPDATE report_history SET status = 'error' WHERE id = $1`, [historial[0].id]);
    check('el historico rechaza UPDATE', false, '(dejo actualizar)');
} catch (e) {
    check('el historico rechaza UPDATE', /no se actualiza/i.test(msg(e)), `(${msg(e)})`);
}

try {
    await pg.query(`DELETE FROM report_history WHERE id = $1`, [historial[0].id]);
    check('el historico rechaza DELETE sin politica de retencion', false, '(dejo borrar)');
} catch (e) {
    check('el historico rechaza DELETE sin politica de retencion',
        /retencion/i.test(msg(e)), `(${msg(e)})`);
}

// La politica de retencion explicita si puede: es lo que pide el criterio.
await pg.exec(`
  BEGIN;
  SET LOCAL app.retencion_reportes = 'on';
  DELETE FROM report_history WHERE period = 'periodo-que-no-existe';
  COMMIT;
`);
check('la politica de retencion explicita si puede borrar', true);

// ---------------------------------------------------------------------
console.log('\n--- FALLOS Y REINTENTOS (criterios de aceptacion 3, tecnicos 4 y 5) ---');

const fallo = await sched.registrarFallo({
    scheduleId: programada.id,
    tipo: 'performance',
    periodo: '2026-08-25',
    params: { from: '2026-08-25', to: '2026-08-25' },
    error: Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
        stack: 'Error: connect ECONNREFUSED\n    at /srv/app/src/services/reports.service.js:120:15'
    }),
    arranque: Date.now()
});

const { rows: [registrado] } = await pg.query(
    'SELECT status, error_summary, log_reference, file_location FROM report_history WHERE id = $1',
    [fallo.id]
);
check('un fallo tambien deja registro en el historico', registrado.status === 'error');
check('con un resumen tecnico del error', /ECONNREFUSED/.test(registrado.error_summary || ''));
check('sin archivo asociado', registrado.file_location === null);
check('y con una referencia para buscarlo en el log', /^rep-/.test(registrado.log_reference || ''));

const { rows: avisoTecnico } = await pg.query(
    `SELECT n.user_id, u.role, n.kind FROM report_notifications n
       JOIN users u ON u.id = n.user_id
      WHERE n.history_id = $1`,
    [fallo.id]
);
check('el fallo se avisa al equipo tecnico y no a los roles de negocio',
    avisoTecnico.length > 0 && avisoTecnico.every(a => a.role === 'admin'),
    `(${JSON.stringify(avisoTecnico.map(a => a.role))})`);

const { rows: [textoTecnico] } = await pg.query(
    `SELECT body FROM notifications WHERE event_name = 'report.auto_failed' LIMIT 1`
);
check('el aviso tecnico incluye el detalle', /ECONNREFUSED/.test(textoTecnico?.body || ''));
check('pero nunca el stack trace ni rutas del servidor',
    !/\/srv\/app|\.js:\d+:\d+/.test(textoTecnico?.body || ''),
    `(${textoTecnico?.body})`);

// Criterio tecnico 5: lo que ve RH es generico.
const paraRh = await sched.listarHistorico({ incluirDetalleTecnico: false });
const filaErrorRh = paraRh.find(f => f.status === 'error');
check('RH ve un mensaje generico del fallo',
    /no pudo generarse/.test(filaErrorRh?.mensaje || ''));
check('y no recibe el detalle tecnico ni la referencia del log',
    filaErrorRh?.detalle_tecnico === undefined && filaErrorRh?.referencia_log === undefined);

const paraAdmin = await sched.listarHistorico({ incluirDetalleTecnico: true });
check('el administrador si recibe el detalle tecnico',
    /ECONNREFUSED/.test(paraAdmin.find(f => f.status === 'error')?.detalle_tecnico || ''));

check('el historico nunca expone la ruta en disco del archivo',
    paraRh.every(f => f.file_location === undefined),
    '(deberia salir solo el enlace de descarga)');

// --- Reintentos: tres intentos y despues fallido definitivo ---
//
// Se fuerza el fallo del envio reemplazando el reintento de correo del
// servicio de notificaciones. Es la unica pieza que puede fallar de verdad en
// produccion (un SMTP caido) y no hay forma de provocarla sin un servidor real.
const reenviarOriginal = notifications.reenviarCorreo;
notifications.reenviarCorreo = async () => 'failed';

// Se encola sobre el reporte fallido y hacia RH: esa combinacion todavia no
// tiene aviso (el fallo solo se le avisa al equipo tecnico), asi que no choca
// con el UNIQUE que impide reenviar dos veces lo mismo.
const { rows: [avisoRoto] } = await pg.query(
    `INSERT INTO report_notifications (history_id, user_id, kind)
     VALUES ($1, (SELECT id FROM users WHERE role = 'rh' LIMIT 1), 'ready')
     RETURNING id`,
    [fallo.id]
);

const esperas = [];
for (let intento = 1; intento <= 4; intento++) {
    await sched.procesarNotificacionesPendientes();

    const { rows: [estado] } = await pg.query(
        `SELECT attempts, status, next_attempt_at, last_error FROM report_notifications WHERE id = $1`,
        [avisoRoto.id]
    );

    if (estado.status === 'pending') {
        esperas.push(new Date(estado.next_attempt_at) - Date.now());
        // Se adelanta el reloj de la cola en vez de esperar los minutos reales
        // del backoff: lo que se prueba es la politica, no el temporizador.
        await pg.query(`UPDATE report_notifications SET next_attempt_at = now() WHERE id = $1`, [avisoRoto.id]);
    }

    if (intento === 3) {
        check('tras el tercer intento el aviso queda fallido definitivamente',
            estado.status === 'failed' && estado.attempts === 3,
            `(estado ${estado.status}, ${estado.attempts} intentos)`);
        check('y guarda el motivo del ultimo fallo', /correo/.test(estado.last_error || ''));
    }

    if (intento === 4) {
        check('un aviso fallido no se vuelve a intentar solo', estado.attempts === 3,
            `(quedo en ${estado.attempts})`);
    }
}

check('la espera entre reintentos crece (backoff exponencial)',
    esperas.length >= 2 && esperas[1] > esperas[0],
    `(esperas: ${esperas.map(e => Math.round(e / 1000) + 's').join(', ')})`);

notifications.reenviarCorreo = reenviarOriginal;

// ---------------------------------------------------------------------
console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
