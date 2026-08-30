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
                 '023_cursos_de_refuerzo', '024_simulacion_de_ejemplo',
                 '025_equipos', '026_exportaciones_de_reportes']) {
  try { await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8')); }
  catch (e) { console.log(`ERROR en ${f}: ${msg(e)}`); fallos++; }
}
console.log('Migraciones aplicadas\n');

const reports = require_('./services/reports.service');
const exports_ = require_('./services/reportExports.service');
const points = require_('./services/points.service');
const levels = require_('./services/levels.service');
const controller = require_('./controllers/report.controller');
const { requireRoles } = require_('./middlewares/role.middleware');

// ---------------------------------------------------------------------
// Datos: tres equipos, seis personas con distinto desempeno.
// ---------------------------------------------------------------------
await pg.exec(`
  INSERT INTO users (email, password, role, team_id) VALUES
    ('rh@hf.com',   'x', 'rh',       4),
    ('ana@hf.com',  'x', 'employee', 1),
    ('beto@hf.com', 'x', 'employee', 1),
    ('caro@hf.com', 'x', 'employee', 2),
    ('dani@hf.com', 'x', 'employee', 2),
    ('eva@hf.com',  'x', 'employee', NULL);
`);

const idDe = async (email) => {
  const { rows } = await pg.query('SELECT id FROM users WHERE email = $1', [email]);
  return rows[0].id;
};

const ana = await idDe('ana@hf.com');
const beto = await idDe('beto@hf.com');
const caro = await idDe('caro@hf.com');
const eva = await idDe('eva@hf.com');
const rh = await idDe('rh@hf.com');

// schema.sql ya siembra admin@humanfirewall.com, asi que el total no son solo
// los seis de arriba. Se cuenta en vez de asumir: si manana cambia la semilla,
// la prueba sigue siendo valida.
const { rows: [conteo] } = await pg.query(
  `SELECT COUNT(*)::int AS n FROM users WHERE is_active = true`
);
const TOTAL = conteo.n;

// Puntos con fechas controladas: unos en enero, otros "hoy".
const movimiento = (userId, puntos, clave, fecha = null) =>
  pg.query(
    `INSERT INTO points_ledger (user_id, source_type, source_id, points, rule_code, idempotency_key, created_at)
     VALUES ($1, 'manual', 'demo', $2, 'manual', $3, COALESCE($4::timestamptz, now()))`,
    [userId, puntos, clave, fecha]
  );

await movimiento(ana, 400, 'a1');
await movimiento(ana, 200, 'a2', '2026-01-15T10:00:00Z');
await movimiento(beto, 50, 'b1');
await movimiento(caro, 1200, 'c1');
await movimiento(eva, 30, 'e1', '2026-01-20T10:00:00Z');
// dani no tiene ningun movimiento: sirve para el caso "sin actividad".

await pg.query(`UPDATE users SET total_points = (SELECT COALESCE(SUM(points),0) FROM points_ledger WHERE user_id = users.id)`);

// ---------------------------------------------------------------------
console.log('--- CONTROL DE ACCESO (criterio tecnico 1) ---');

// El 403 tiene que salir del middleware, ANTES del controlador y sin tocar la
// base. Se ejercita el middleware real con un req/res de mentira.
const correrMiddleware = (rol) => {
    let estado = null, cuerpo = null, siguio = false;
    const res = { status(c) { estado = c; return this; }, json(b) { cuerpo = b; return this; } };
    requireRoles(['rh', 'admin'])({ user: rol ? { id: 1, role: rol } : null }, res, () => { siguio = true; });
    return { estado, cuerpo, siguio };
};

check('un empleado recibe 403', correrMiddleware('employee').estado === 403);
check('un instructor recibe 403', correrMiddleware('instructor').estado === 403);
check('sin usuario autenticado recibe 401', correrMiddleware(null).estado === 401);
check('rh pasa al controlador', correrMiddleware('rh').siguio === true);
check('admin pasa al controlador', correrMiddleware('admin').siguio === true);

// El 403 no debe ejecutar ninguna consulta al reporte. Se verifica contando
// las llamadas a la base durante el middleware.
let consultas = 0;
const queryOriginal = adapter.query;
adapter.query = (t, p) => { consultas++; return queryOriginal(t, p); };
correrMiddleware('employee');
adapter.query = queryOriginal;
check('el rechazo por rol no consulta la base', consultas === 0, `(hizo ${consultas} consultas)`);

// ---------------------------------------------------------------------
console.log('\n--- VALIDACION DE FILTROS (criterio tecnico 2) ---');

const v = async (q) => reports.validarFiltros(q);

check('acepta fechas ISO validas', (await v({ from: '2026-01-01', to: '2026-03-31' })).errores.length === 0);
check('rechaza formato de fecha invalido',
  (await v({ from: '01/03/2026' })).errores[0]?.campo === 'from');
check('rechaza una fecha que no existe (2026-02-31)',
  (await v({ from: '2026-02-31' })).errores.length === 1);
check('rechaza mes 13', (await v({ to: '2026-13-01' })).errores.length === 1);
check('rechaza un rango invertido',
  (await v({ from: '2026-06-01', to: '2026-01-01' })).errores.length === 1);

const equipoInexistente = await v({ team_id: '9999' });
check('rechaza un team_id inexistente', equipoInexistente.errores[0]?.campo === 'team_id');
check('el error dice cual es el campo y por que',
  /No existe/.test(equipoInexistente.errores[0]?.detalle || ''),
  `("${equipoInexistente.errores[0]?.detalle}")`);
check('rechaza un team_id no numerico', (await v({ team_id: 'abc' })).errores.length === 1);
check('rechaza un course_id inexistente', (await v({ course_id: '4242' })).errores[0]?.campo === 'course_id');
check('acepta un team_id que si existe', (await v({ team_id: '1' })).filtros.teamId === 1);

const variosErrores = await v({ from: 'ayer', team_id: '9999' });
check('acumula todos los errores, no solo el primero', variosErrores.errores.length === 2,
  `(dio ${variosErrores.errores.length})`);

// El controlador tiene que cortar en 400 sin llegar a consultar el reporte.
let estado400 = null, cuerpo400 = null;
await controller.getPerformanceReport(
  { query: { from: 'no-es-fecha' }, user: { id: rh, role: 'rh' } },
  { status(c) { estado400 = c; return this; }, json(b) { cuerpo400 = b; return this; } }
);
check('el controlador responde 400 ante un filtro invalido', estado400 === 400);
check('y devuelve el detalle del campo', cuerpo400?.errores?.[0]?.campo === 'from');

// ---------------------------------------------------------------------
console.log('\n--- REPORTE (criterios de aceptacion 1 y 2) ---');

const todo = await reports.obtenerReporteDesempeno(
  { from: null, to: null, teamId: null, courseId: null },
  { page: 1, pageSize: 50 }
);

check('lista a los usuarios activos', todo.paginacion.total === TOTAL, `(dio ${todo.paginacion.total}, esperaba ${TOTAL})`);
check('ordena por puntos descendente',
  todo.resultados[0].email === 'caro@hf.com' && todo.resultados[0].puntos === 1200,
  `(primero: ${todo.resultados[0]?.email})`);

const filaAna = todo.resultados.find(r => r.email === 'ana@hf.com');
check('suma los puntos del historial', filaAna.puntos === 600, `(dio ${filaAna.puntos})`);
check('trae el nivel con su nombre', filaAna.nivel === 3 && filaAna.nivel_nombre === 'Intermedio',
  `(nivel ${filaAna.nivel} ${filaAna.nivel_nombre})`);
check('trae el equipo', filaAna.equipo === 'Tecnologia', `(dio ${filaAna.equipo})`);

const filaEva = todo.resultados.find(r => r.email === 'eva@hf.com');
check('un usuario sin equipo aparece como "Sin equipo"', filaEva.equipo === 'Sin equipo');

const filaDani = todo.resultados.find(r => r.email === 'dani@hf.com');
check('un usuario sin actividad aparece con 0 y sin fecha',
  filaDani.puntos === 0 && filaDani.ultima_actividad === null);

// El nivel tiene que salir del servicio de niveles, no de una copia de la
// formula. Se comprueba comparando contra el propio servicio.
const escalera = await levels.obtenerEscalera();
const esperado = levels.calcularProgreso(600, escalera);
check('el nivel coincide con el que calcula levels.service',
  filaAna.nivel === esperado.nivel_actual && filaAna.porcentaje_avance === esperado.porcentaje_avance);

// Si cambian los umbrales, el reporte cambia solo: no hay reglas duplicadas.
await pg.query(`UPDATE levels_config SET min_points = 550 WHERE level = 4`);
const trasCambio = await reports.obtenerReporteDesempeno(
  { from: null, to: null, teamId: null, courseId: null }, { page: 1, pageSize: 50 });
check('cambiar un umbral cambia el nivel del reporte, sin tocar codigo',
  trasCambio.resultados.find(r => r.email === 'ana@hf.com').nivel === 4,
  `(dio ${trasCambio.resultados.find(r => r.email === 'ana@hf.com').nivel})`);
await pg.query(`UPDATE levels_config SET min_points = 701 WHERE level = 4`);

console.log('\n--- FILTROS ---');

const porEquipo = await reports.obtenerReporteDesempeno(
  { from: null, to: null, teamId: 1, courseId: null }, { page: 1, pageSize: 50 });
check('filtra por equipo', porEquipo.paginacion.total === 2, `(dio ${porEquipo.paginacion.total})`);
check('solo trae gente de ese equipo',
  porEquipo.resultados.every(r => r.equipo === 'Tecnologia'));

const enero = await reports.obtenerReporteDesempeno(
  { from: '2026-01-01', to: '2026-01-31', teamId: null, courseId: null }, { page: 1, pageSize: 50 });
check('el filtro de fechas deja solo a quien tuvo actividad en el rango',
  enero.paginacion.total === 2, `(dio ${enero.paginacion.total})`);
check('y los puntos son los del rango, no los totales',
  enero.resultados.find(r => r.email === 'ana@hf.com').puntos === 200,
  `(dio ${enero.resultados.find(r => r.email === 'ana@hf.com')?.puntos})`);

const vacio = await reports.obtenerReporteDesempeno(
  { from: '2019-01-01', to: '2019-12-31', teamId: null, courseId: null }, { page: 1, pageSize: 50 });
check('un rango sin datos devuelve estado vacio, no un error',
  vacio.vacio === true && vacio.resultados.length === 0 && vacio.paginacion.total === 0);
check('el estado vacio tambien vacia los agregados',
  vacio.agregados.por_equipo.length === 0);

console.log('\n--- AGREGADOS ---');

const equipos = todo.agregados.por_equipo;
const tecnologia = equipos.find(e => e.equipo === 'Tecnologia');
check('agrega por equipo', tecnologia.usuarios === 2 && tecnologia.puntos === 650,
  `(${tecnologia.usuarios} usuarios, ${tecnologia.puntos} pts)`);
check('calcula el promedio del equipo', tecnologia.promedio_puntos === 325,
  `(dio ${tecnologia.promedio_puntos})`);
check('los que no tienen equipo se agrupan aparte',
  equipos.some(e => e.equipo === 'Sin equipo'));

console.log('\n--- PAGINACION (criterio tecnico 4) ---');

const p1 = await reports.obtenerReporteDesempeno(
  { from: null, to: null, teamId: null, courseId: null }, { page: 1, pageSize: 2 });
const p2 = await reports.obtenerReporteDesempeno(
  { from: null, to: null, teamId: null, courseId: null }, { page: 2, pageSize: 2 });

check('devuelve los metadatos page, page_size y total',
  p1.paginacion.page === 1 && p1.paginacion.page_size === 2 && p1.paginacion.total === TOTAL);
check('calcula el total de paginas', p1.paginacion.total_paginas === Math.ceil(TOTAL / 2), `(dio ${p1.paginacion.total_paginas})`);
check('la pagina 2 trae usuarios distintos',
  p1.resultados.every(a => !p2.resultados.some(b => b.user_id === a.user_id)));
check('el total no cambia entre paginas', p1.paginacion.total === p2.paginacion.total);
check('el tamano por defecto es 50', reports.PAGE_SIZE_POR_DEFECTO === 50);
check('page_size se topea para que nadie pida 100000 filas',
  reports.normalizarPaginacion({ page_size: '100000' }).pageSize <= 200);
check('una pagina negativa se normaliza a 1', reports.normalizarPaginacion({ page: '-5' }).page === 1);

// ---------------------------------------------------------------------
console.log('\n--- EXPORTACION (criterio de aceptacion 3) ---');

const filtrosVacios = { from: null, to: null, teamId: null, courseId: null };

const sync = await exports_.solicitarExportacion({ userId: rh, formato: 'csv', filtros: filtrosVacios });
check('con pocos registros se genera en el momento', sync.modo === 'sincrono');
check('devuelve un CSV', sync.archivo.mime.startsWith('text/csv'));

const csv = sync.archivo.buffer.toString('utf8');
check('el CSV trae encabezado y una fila por usuario',
  csv.trim().split('\r\n').length === TOTAL + 1,
  `(${csv.trim().split('\r\n').length} lineas, esperaba ${TOTAL + 1})`);
check('incluye los datos de la tabla', /caro@hf\.com,Finanzas,1200/.test(csv));

// Criterio de aceptacion 3: el archivo refleja los filtros de pantalla.
const conFiltro = await exports_.solicitarExportacion({
  userId: rh, formato: 'csv', filtros: { ...filtrosVacios, teamId: 1 }
});
const csvFiltrado = conFiltro.archivo.buffer.toString('utf8');
check('la exportacion respeta el filtro aplicado',
  csvFiltrado.includes('ana@hf.com') && !csvFiltrado.includes('caro@hf.com'));

check('el nombre del archivo no lleva datos sensibles',
  !/[@]|ana|caro|Tecnologia|2026-01/.test(sync.archivo.fileName),
  `(${sync.archivo.fileName})`);
check('el nombre se arma con el identificador aleatorio',
  sync.archivo.fileName === `reporte-desempeno-${sync.exportUid}.csv`);

const pdf = await exports_.solicitarExportacion({ userId: rh, formato: 'pdf', filtros: filtrosVacios });
check('genera PDF', pdf.archivo.buffer.slice(0, 5).toString() === '%PDF-');
check('el PDF no esta vacio', pdf.archivo.buffer.length > 1000, `(${pdf.archivo.buffer.length} bytes)`);

let errorFormato = null;
try { await exports_.solicitarExportacion({ userId: rh, formato: 'xlsx', filtros: filtrosVacios }); }
catch (e) { errorFormato = e; }
check('un formato no soportado se rechaza', errorFormato?.campo === 'format');

console.log('\n--- INYECCION DE FORMULAS EN CSV ---');

// Un correo que empiece con "=" seria interpretado como formula por Excel.
check('un valor que empieza con = se neutraliza', exports_.escaparCSV('=1+1').startsWith("'"));
check('lo mismo con + - @', ['+x', '-x', '@x'].every(v => exports_.escaparCSV(v).startsWith("'")));
check('las comillas se escapan duplicandolas', exports_.escaparCSV('di "hola"') === '"di ""hola"""');
check('un valor con coma se encierra entre comillas', exports_.escaparCSV('a,b') === '"a,b"');
check('un valor normal no se toca', exports_.escaparCSV('ana@hf.com') === 'ana@hf.com');

console.log('\n--- AUDITORIA (criterio tecnico 6) ---');

const { rows: auditoria } = await pg.query(
  `SELECT requested_by, report_type, format, filters, status FROM report_exports ORDER BY id`);
check('cada exportacion generada queda registrada', auditoria.length === 3, );
check('un formato invalido no deja registro: no se exporto nada',
  !auditoria.some(a => a.format === 'xlsx'));
check('registra quien la pidio', auditoria.every(a => a.requested_by === rh));
check('registra los filtros aplicados',
  auditoria.some(a => a.filters?.teamId === 1), `(${JSON.stringify(auditoria.map(a => a.filters))})`);
check('registra el timestamp del servidor',
  (await pg.query('SELECT created_at FROM report_exports LIMIT 1')).rows[0].created_at instanceof Date);

// Lo importante: esos datos NO pueden salir por la API.
const estado = await exports_.obtenerEstado(sync.exportUid);
const camposExpuestos = Object.keys(estado);
check('el estado no expone los filtros', !camposExpuestos.includes('filters'));
check('el estado no expone quien la solicito', !camposExpuestos.includes('requested_by'));

let cuerpoEstado = null;
await controller.getExportStatus(
  { params: { exportId: sync.exportUid }, user: { id: rh, role: 'rh' } },
  { status() { return this; }, json(b) { cuerpoEstado = b; return this; } }
);
const fuga = ['filters', 'filtros', 'requested_by', 'solicitante'].filter(k => k in cuerpoEstado);
check('la respuesta del endpoint tampoco filtra auditoria', fuga.length === 0, `(fuga: ${fuga})`);

console.log('\n--- EXPORTACION ASINCRONA (criterio tecnico 5) ---');

// Se fuerza el camino asincrono bajando el umbral a 1.
const umbralOriginal = process.env.REPORT_EXPORT_SYNC_LIMIT;
process.env.REPORT_EXPORT_SYNC_LIMIT = '1';
delete require_.cache[require_.resolve('./services/reportExports.service')];
const exportsBajoUmbral = require_('./services/reportExports.service');

check('el umbral se lee del entorno', exportsBajoUmbral.LIMITE_SINCRONO === 1);

const async_ = await exportsBajoUmbral.solicitarExportacion({
  userId: rh, formato: 'csv', filtros: filtrosVacios
});
check('por encima del umbral se encola', async_.modo === 'asincrono');
check('devuelve un export_id', typeof async_.exportUid === 'string' && async_.exportUid.length === 32);
check('informa cuantos registros son', async_.total === TOTAL, `(dio ${async_.total})`);

const { rows: encolado } = await pg.query(
  `SELECT status FROM report_exports WHERE export_uid = $1`, [async_.exportUid]);
check('queda en estado pending', encolado[0].status === 'pending');

const { rows: evento } = await pg.query(
  `SELECT event_name FROM event_outbox WHERE event_name = 'report.export_requested'`);
check('publica el evento en la cola', evento.length === 1, `(hay ${evento.length})`);

// El worker lo procesa.
await exportsBajoUmbral.procesarExportacion({
  exportUid: async_.exportUid, formato: 'csv', filtros: filtrosVacios
});
const trasProcesar = await exportsBajoUmbral.obtenerEstado(async_.exportUid);
check('tras procesarlo queda listo', trasProcesar.status === 'ready');
check('y registra cuantas filas tenia', trasProcesar.row_count === TOTAL, `(dio ${trasProcesar.row_count})`);

// El handler tiene que ser idempotente: el worker reintenta.
const reintento = await exportsBajoUmbral.procesarExportacion({
  exportUid: async_.exportUid, formato: 'csv', filtros: filtrosVacios
});
check('reprocesar una exportacion ya lista no la regenera', reintento === null);

process.env.REPORT_EXPORT_SYNC_LIMIT = umbralOriginal;

console.log('\n--- CATALOGO DE EVENTOS ---');
const { EVENTOS, SUSCRIPTORES_ESPERADOS } = require_('./events/catalogo');
check('el evento de exportacion esta en el catalogo',
  EVENTOS.REPORT_EXPORT_REQUESTED === 'report.export_requested');
check('y declara su suscriptor',
  SUSCRIPTORES_ESPERADOS[EVENTOS.REPORT_EXPORT_REQUESTED]?.includes('reportExports'));

console.log('\n--- ALTA Y ASIGNACION DE USUARIOS ---');

// La migracion 025 creo users.team_id, pero sin estos endpoints la unica
// forma de asignarle equipo a alguien era un UPDATE a mano en la base, y el
// filtro por equipo del reporte quedaba inusable en la practica.
const userService = require_('./services/user.service');
const userController = require_('./controllers/user.controller');

const llamarUsuarios = async (handler, { body = {}, params = {}, user = { id: rh, role: 'admin' } } = {}) => {
    let estado = 200, cuerpo = null;
    const res = { status(c) { estado = c; return this; }, json(b) { cuerpo = b; return this; } };
    await handler({ body, params, user }, res);
    return { estado, cuerpo };
};

const alta = await llamarUsuarios(userController.create, {
    body: { email: 'nuevo@hf.com', password: 'Empresa2026', role: 'employee', team_id: 1 }
});
check('crea un usuario con su equipo', alta.estado === 201 && alta.cuerpo.usuario.team_id === 1,
  );

const duplicado = await llamarUsuarios(userController.create, {
    body: { email: 'nuevo@hf.com', password: 'Empresa2026' }
});
check('un correo repetido da 409 y no un 500', duplicado.estado === 409, );

const claveDebil = await llamarUsuarios(userController.create, {
    body: { email: 'otro@hf.com', password: '123' }
});
check('exige la misma fuerza de clave que el registro publico',
  claveDebil.estado === 400 && claveDebil.cuerpo.errores[0].campo === 'password');

const equipoMalo = await llamarUsuarios(userController.create, {
    body: { email: 'otro2@hf.com', password: 'Empresa2026', team_id: 999 }
});
check('rechaza un equipo inexistente con el campo concreto',
  equipoMalo.estado === 400 && equipoMalo.cuerpo.errores[0].campo === 'team_id');

const rolMalo = await llamarUsuarios(userController.create, {
    body: { email: 'otro3@hf.com', password: 'Empresa2026', role: 'jefe' }
});
check('rechaza un rol que no existe', rolMalo.estado === 400 && rolMalo.cuerpo.errores[0].campo === 'role');

// Reasignacion.
const nuevoId = alta.cuerpo.usuario.id;
const cambio = await llamarUsuarios(userController.updateUser, {
    params: { id: String(nuevoId) }, body: { team_id: 2, role: 'instructor' }
});
check('cambia equipo y rol en la misma llamada',
  cambio.cuerpo.usuario.team_id === 2 && cambio.cuerpo.usuario.role === 'instructor');

// null explicito != campo ausente.
const sinEquipo = await llamarUsuarios(userController.updateUser, {
    params: { id: String(nuevoId) }, body: { team_id: null }
});
check('team_id null saca a la persona del equipo', sinEquipo.cuerpo.usuario.team_id === null);

const sinCampos = await llamarUsuarios(userController.updateUser, {
    params: { id: String(nuevoId) }, body: {}
});
check('un PUT sin campos avisa en vez de fingir que actualizo', sinCampos.estado === 400);

const inexistente = await llamarUsuarios(userController.updateUser, {
    params: { id: '99999' }, body: { role: 'employee' }
});
check('actualizar un usuario inexistente da 404', inexistente.estado === 404);

const autobaja = await llamarUsuarios(userController.deactivateUser, {
    params: { id: String(rh) }, user: { id: rh, role: 'admin' }
});
check('un admin no puede desactivarse a si mismo', autobaja.estado === 400);

const listado = await userService.getUsers();
check('el listado incluye el equipo y el estado',
  listado.every(u => 'equipo' in u && 'is_active' in u));

const equiposDisponibles = await userService.getTeams();
check('los equipos vienen con su cantidad de integrantes',
  equiposDisponibles.length === 5 && equiposDisponibles.every(t => typeof t.integrantes === 'number'),
  `(${equiposDisponibles.length} equipos)`);

check('todas las conexiones se devolvieron al pool', conexionesAbiertas === 0, `(quedaron ${conexionesAbiertas})`);

console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
