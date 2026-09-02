/**
 * Pruebas de la HU de resultados organizacionales consolidados.
 *
 * Lo que se verifica:
 *
 *   - que el 403 salga del middleware, sin ejecutar ninguna agregacion,
 *   - que la lectura NO toque points_ledger (criterio tecnico 2),
 *   - que un periodo sin snapshot devuelva un estado explicito y no un error,
 *   - que la variacion sea (b - a) / a y que con a = 0 no reviente,
 *   - que segmentar por area cambie los numeros y que un area invalida de 404,
 *   - que el recalculo no sobrescriba snapshots anteriores,
 *   - y que la bitacora de consultas exista, sea inmutable y no salga por la API.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
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

const org = require_('./services/orgReports.service');
const controller = require_('./controllers/orgReports.controller');
const { requireRoles } = require_('./middlewares/role.middleware');

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
console.log('--- CONTROL DE ACCESO (criterio tecnico 1) ---');

const correrMiddleware = (rol) => {
    let estado = null, siguio = false;
    const res = { status(c) { estado = c; return this; }, json() { return this; } };
    requireRoles(['manager', 'admin'])({ user: rol ? { id: 1, role: rol } : null }, res, () => { siguio = true; });
    return { estado, siguio };
};

check('un empleado recibe 403', correrMiddleware('employee').estado === 403);
check('rh recibe 403: el consolidado organizacional es de gerencia', correrMiddleware('rh').estado === 403);
check('seguridad recibe 403', correrMiddleware('security').estado === 403);
check('sin usuario autenticado recibe 401', correrMiddleware(null).estado === 401);
check('un gerente pasa al controlador', correrMiddleware('manager').siguio === true);
check('un admin pasa al controlador', correrMiddleware('admin').siguio === true);

let consultas = 0;
const queryOriginal = adapter.query;
adapter.query = (t, p) => { consultas++; return queryOriginal(t, p); };
correrMiddleware('rh');
adapter.query = queryOriginal;
check('el rechazo por rol no ejecuta ninguna consulta de agregacion', consultas === 0,
    `(hizo ${consultas} consultas)`);

// ---------------------------------------------------------------------
console.log('\n--- DATOS ---');

await pg.exec(`
  INSERT INTO users (email, password, role, team_id) VALUES
    ('ana@hf.com',   'x', 'employee', 1),
    ('beto@hf.com',  'x', 'employee', 1),
    ('caro@hf.com',  'x', 'employee', 2),
    ('dani@hf.com',  'x', 'employee', 2),
    ('eva@hf.com',   'x', 'employee', NULL);
`);

const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const ana = await idDe('ana@hf.com');
const beto = await idDe('beto@hf.com');
const caro = await idDe('caro@hf.com');
const gerente = await idDe('gerencia@humanfirewall.com');

const ESTE = '2026-05';
const ANTERIOR = '2026-04';

const movimiento = (userId, puntos, clave, fecha) =>
    pg.query(
        `INSERT INTO points_ledger (user_id, source_type, source_id, points, rule_code, idempotency_key, created_at)
         VALUES ($1, 'manual', 'demo', $2, 'manual', $3, $4::timestamptz)`,
        [userId, puntos, clave, fecha]
    );

// Abril: solo ana tuvo actividad.
await movimiento(ana, 100, 'a-abr', '2026-04-10T10:00:00Z');

// Mayo: ana y beto (equipo 1) y caro (equipo 2).
await movimiento(ana, 300, 'a-may', '2026-05-05T10:00:00Z');
await movimiento(ana, 200, 'a-may2', '2026-05-06T10:00:00Z');
await movimiento(beto, 150, 'b-may', '2026-05-07T10:00:00Z');
await movimiento(caro, 400, 'c-may', '2026-05-08T10:00:00Z');

await org.recalcularPeriodo(ANTERIOR);
await org.recalcularPeriodo(ESTE);

// ---------------------------------------------------------------------
console.log('\n--- LECTURA DESDE SNAPSHOTS (criterio tecnico 2) ---');

const consultado = [];
adapter.query = (t, p) => { consultado.push(String(t)); return queryOriginal(t, p); };
const reporte = await org.obtenerReporteOrganizacional({ userId: gerente, periodo: ESTE, compararCon: ANTERIOR });
adapter.query = queryOriginal;

check('el reporte se responde con estado listo', reporte.estado === 'listo');
check('trae los cuatro KPIs de la historia',
    ['participacion', 'progreso_promedio', 'cursos_completados', 'engagement']
        .every(k => reporte.kpis.some(x => x.kpi_type === k)),
    `(${reporte.kpis.map(k => k.kpi_type).join(', ')})`);

check('la lectura NO consulta points_ledger',
    !consultado.some(sql => /points_ledger/i.test(sql)),
    '(alguna consulta toco la tabla transaccional)');
check('la lectura si consulta la tabla de snapshots',
    consultado.some(sql => /org_kpi_snapshots/i.test(sql)));

const participacion = reporte.kpis.find(k => k.kpi_type === 'participacion');
// Padron: admin, rh, seguridad, gerencia, ana, beto, caro, dani, eva = 9.
// Activos en mayo: ana, beto, caro = 3.
check('la participacion se calcula sobre el total de la organizacion, no por usuario',
    participacion.detalle.padron === 9 && participacion.detalle.activos === 3,
    `(${JSON.stringify(participacion.detalle)})`);
check('y sale como porcentaje', Math.round(participacion.valor) === 33, `(dio ${participacion.valor})`);

// ---------------------------------------------------------------------
console.log('\n--- COMPARACION DE PERIODOS (criterio tecnico 4) ---');

check('la formula es (period_b - period_a) / period_a',
    org.calcularVariacion(10, 15).variacion === 0.5,
    `(dio ${org.calcularVariacion(10, 15).variacion})`);
check('una caida da variacion negativa',
    org.calcularVariacion(20, 15).tendencia === 'negativa');
check('sin cambio no se marca ni positiva ni negativa',
    org.calcularVariacion(10, 10).tendencia === 'sin_cambio');

const conCero = org.calcularVariacion(0, 5);
check('con periodo base 0 devuelve un valor explicito, no un error de division',
    conCero.variacion === null && conCero.tendencia === 'sin_datos_comparables',
    `(${JSON.stringify(conCero)})`);
check('y explica por que no hay comparacion', /base es 0/.test(conCero.motivo || ''));

const sinSnapshot = org.calcularVariacion(null, 5);
check('sin snapshot del periodo base tampoco inventa un numero',
    sinSnapshot.variacion === null && sinSnapshot.tendencia === 'sin_datos_comparables');

// Abril tuvo 1 activo de 9 (11.11%), mayo 3 de 9 (33.33%).
check('la variacion entre periodos reales sale calculada',
    participacion.variacion_porcentaje === 200,
    `(dio ${participacion.variacion_porcentaje}%, valores ${participacion.valor_comparado} -> ${participacion.valor})`);

// ---------------------------------------------------------------------
console.log('\n--- PERIODO SIN CALCULAR (criterio tecnico 2) ---');

const pendiente = await org.obtenerReporteOrganizacional({ userId: gerente, periodo: '2019-01' });
check('un periodo sin snapshots devuelve estado pendiente_de_calculo',
    pendiente.estado === 'pendiente_de_calculo');
check('con un mensaje que lo explica', /Todavia no hay KPIs/.test(pendiente.mensaje || ''));
check('y sin KPIs inventados en cero', pendiente.kpis.length === 0);

const respuestaPendiente = await llamar(controller.getOrganizationalReport, {
    user: { id: gerente, role: 'manager' }, query: { period: '2019-01' }
});
check('el controlador lo responde con 200, no con un error generico',
    respuestaPendiente.estado === 200 && respuestaPendiente.cuerpo.estado === 'pendiente_de_calculo',
    `(dio ${respuestaPendiente.estado})`);

// ---------------------------------------------------------------------
console.log('\n--- SEGMENTACION POR AREA (criterios de aceptacion 3 y tecnico 5) ---');

const area1 = await org.obtenerReporteOrganizacional({ userId: gerente, periodo: ESTE, areaId: 1 });
const p1 = area1.kpis.find(k => k.kpi_type === 'participacion');
check('al segmentar, los KPIs se recalculan solo con los datos del area',
    p1.detalle.padron === 4 && p1.detalle.activos === 2,
    `(${JSON.stringify(p1.detalle)})`);
check('el reporte dice que area esta mostrando', area1.area?.id === 1);

const area2 = await org.obtenerReporteOrganizacional({ userId: gerente, periodo: ESTE, areaId: 2 });
check('otra area da numeros distintos',
    area2.kpis.find(k => k.kpi_type === 'participacion').detalle.activos === 1);

check('el consolidado general se obtiene simplemente sin area',
    (await org.obtenerReporteOrganizacional({ userId: gerente, periodo: ESTE })).area === null);

check('la respuesta trae las areas disponibles para el filtro',
    Array.isArray(area1.areas_disponibles) && area1.areas_disponibles.length > 0);

const inexistente = await llamar(controller.getOrganizationalReport, {
    user: { id: gerente, role: 'manager' }, query: { area_id: '9999' }
});
check('un area inexistente responde 404', inexistente.estado === 404);
check('y el detalle dice cual era el area_id invalido', inexistente.cuerpo?.area_id === 9999,
    `(${JSON.stringify(inexistente.cuerpo)})`);

await pg.query('UPDATE teams SET is_active = false WHERE id = 5');
const desactivada = await llamar(controller.getOrganizationalReport, {
    user: { id: gerente, role: 'manager' }, query: { area_id: '5' }
});
check('un area desactivada tambien responde 404', desactivada.estado === 404);
check('y el mensaje aclara que esta desactivada, no que no existe',
    /desactivada/.test(desactivada.cuerpo?.msg || ''));
await pg.query('UPDATE teams SET is_active = true WHERE id = 5');

// El area se valida ANTES de leer snapshots.
const antesDeSegmentar = [];
adapter.query = (t, p) => { antesDeSegmentar.push(String(t)); return queryOriginal(t, p); };
await llamar(controller.getOrganizationalReport, {
    user: { id: gerente, role: 'manager' }, query: { area_id: '9999' }
});
adapter.query = queryOriginal;
check('con un area invalida no se llega a leer ningun snapshot',
    !antesDeSegmentar.some(sql => /org_kpi_snapshots/i.test(sql)),
    '(se leyeron snapshots antes de validar el area)');

// ---------------------------------------------------------------------
console.log('\n--- SNAPSHOTS: SE AGREGAN, NO SE PISAN (criterio tecnico 3) ---');

const contarSnapshots = async () =>
    (await pg.query(
        `SELECT COUNT(*)::int AS n FROM org_kpi_snapshots
          WHERE period = $1 AND area_id IS NULL AND kpi_type = 'participacion'`, [ESTE]
    )).rows[0].n;

const antesDelRecalculo = await contarSnapshots();
await movimiento(beto, 50, 'b-may2', '2026-05-20T10:00:00Z');
await org.recalcularPeriodo(ESTE);
const despuesDelRecalculo = await contarSnapshots();

check('un recalculo agrega un snapshot nuevo en vez de sobrescribir el anterior',
    despuesDelRecalculo === antesDelRecalculo + 1,
    `(paso de ${antesDelRecalculo} a ${despuesDelRecalculo})`);

const { rows: [ultimo] } = await pg.query(
    `SELECT value FROM org_kpi_snapshots
      WHERE period = $1 AND area_id IS NULL AND kpi_type = 'engagement'
      ORDER BY calculated_at DESC, id DESC LIMIT 1`, [ESTE]
);
const relectura = await org.obtenerReporteOrganizacional({ userId: gerente, periodo: ESTE });
check('la lectura toma siempre el snapshot mas reciente',
    relectura.kpis.find(k => k.kpi_type === 'engagement').valor === Number(ultimo.value),
    `(leyo ${relectura.kpis.find(k => k.kpi_type === 'engagement').valor}, ultimo ${ultimo.value})`);
check('la respuesta dice cuando se calculo lo que se esta viendo',
    relectura.calculado_en != null);

check('la tendencia devuelve una serie ordenada de periodos',
    relectura.tendencia.length >= 2 &&
    relectura.tendencia[0].period < relectura.tendencia[relectura.tendencia.length - 1].period,
    `(${JSON.stringify(relectura.tendencia)})`);

// ---------------------------------------------------------------------
console.log('\n--- BITACORA DE CONSULTAS (criterio tecnico 6) ---');

const { rows: [bitacora] } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM org_report_access_log WHERE requested_by = $1`, [gerente]
);
check('cada consulta queda registrada con el id del solicitante', bitacora.n > 0);

const { rows: [ultimaConsulta] } = await pg.query(
    `SELECT requested_by, period, area_id, params, requested_at
       FROM org_report_access_log ORDER BY id DESC LIMIT 1`
);
check('con los parametros de la consulta', ultimaConsulta.period != null && ultimaConsulta.params != null,
    `(${JSON.stringify(ultimaConsulta)})`);
check('y con el timestamp del servidor', ultimaConsulta.requested_at instanceof Date);

const respuestaApi = await llamar(controller.getOrganizationalReport, {
    user: { id: gerente, role: 'manager' }, query: { period: ESTE }
});
const cuerpoSerializado = JSON.stringify(respuestaApi.cuerpo);
check('la bitacora no se expone en la respuesta de la API',
    !/requested_by|access_log|requested_at/i.test(cuerpoSerializado));

try {
    await pg.query(`UPDATE org_report_access_log SET period = 'otro' WHERE id = 1`);
    check('la bitacora rechaza UPDATE', false, '(dejo actualizar)');
} catch (e) {
    check('la bitacora rechaza UPDATE', /inmutable/i.test(msg(e)), `(${msg(e)})`);
}

try {
    await pg.query(`DELETE FROM org_report_access_log WHERE id = 1`);
    check('la bitacora rechaza DELETE', false, '(dejo borrar)');
} catch (e) {
    check('la bitacora rechaza DELETE', /inmutable/i.test(msg(e)), `(${msg(e)})`);
}

// Un reporte generado por el sistema (sin usuario) no ensucia la bitacora de
// accesos: esa tabla responde "quien miro estos datos".
const { rows: [antesDelSistema] } = await pg.query('SELECT COUNT(*)::int AS n FROM org_report_access_log');
await org.generarCsvOrganizacional({ periodo: ESTE });
const { rows: [despuesDelSistema] } = await pg.query('SELECT COUNT(*)::int AS n FROM org_report_access_log');
check('el reporte automatico no se registra como consulta de una persona',
    antesDelSistema.n === despuesDelSistema.n);

const csv = await org.generarCsvOrganizacional({ periodo: ESTE });
check('el CSV del consolidado trae una fila por KPI', csv.filas === 4);
check('y viene con codificacion utf-8 declarada', /utf-8/.test(csv.mime));

// ---------------------------------------------------------------------
console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
