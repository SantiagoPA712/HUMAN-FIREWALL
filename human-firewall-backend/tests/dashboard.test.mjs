import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e = '') => {
    if (c) {
        console.log(`  OK    ${n}`);
        ok++;
    } else {
        console.log(`  FALLA ${n} ${e}`);
        fallos++;
    }
};
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

const migraciones = [
    '001_points_ledger', '002_points_rules', '003_lesson_quiz_tracking',
    '004_event_outbox', '005_rol_rh', '006_rewards_catalog', '007_user_rewards',
    '008_desafios_faltantes', '009_notificaciones', '010_recomendaciones_precalculadas',
    '020_levels_config', '021_user_level_history', '022_recommendation_rules',
    '023_cursos_de_refuerzo', '024_simulacion_de_ejemplo', '025_equipos',
    '026_exportaciones_de_reportes', '027_usuarios_iniciales',
    '028_rol_seguridad', '029_anomalias', '030_audit_log',
    '031_report_permissions', '032_dashboard_config'
];

for (const f of migraciones) {
    try {
        await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8'));
    } catch (e) {
        console.log(`ERROR en ${f}: ${msg(e)}`);
        fallos++;
    }
}
console.log('Migraciones aplicadas con exito (incluyendo 032_dashboard_config.sql)\n');

const dashboardController = require_('./controllers/dashboard.controller');
const dashboardService = require_('./services/dashboard.service');

const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;

const adminId = await idDe('admin@humanfirewall.com');
const rhId = await idDe('rh@humanfirewall.com');
const segId = await idDe('seguridad@humanfirewall.com');

await pg.exec(`
    INSERT INTO users (email, password, role) VALUES
    ('empleado.dash@hf.com', 'hash', 'employee');
`);
const empId = await idDe('empleado.dash@hf.com');

/** Helper para invocar controladores */
const llamar = async (handler, { body = {}, params = {}, query = {}, user } = {}) => {
    let estado = 200, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await handler({ body, params, query, user, headers: {} }, res);
    return { estado, cuerpo };
};

console.log('--- 1. COMPOSICION DE DASHBOARD Y FILTRADO POR ROL EN BACKEND ---');

// 1.1 Empleado
const empDash = await llamar(dashboardController.getDashboard, {
    user: { id: empId, role: 'employee' }
});

check('GET /dashboard para employee retorna 200 OK', empDash.estado === 200);
const empWidgetIds = empDash.cuerpo?.widgets?.map(w => w.id) || [];
check('Employee solo recibe widgets de dashboard/progreso personal',
    empWidgetIds.includes('my_progress') && empWidgetIds.includes('leaderboard'));
check('Employee NO recibe widgets organizacionales ni de seguridad',
    !empWidgetIds.includes('security_anomalies') &&
    !empWidgetIds.includes('audit_log') &&
    !empWidgetIds.includes('organizational_overview'));
check('Retorna intervalo de polling configurable',
    typeof empDash.cuerpo?.polling_interval_seconds === 'number');

// 1.2 RH
const rhDash = await llamar(dashboardController.getDashboard, {
    user: { id: rhId, role: 'rh' }
});
const rhWidgetIds = rhDash.cuerpo?.widgets?.map(w => w.id) || [];
check('RH recibe widgets de progreso, ranking, organizational y performance',
    rhWidgetIds.includes('my_progress') &&
    rhWidgetIds.includes('leaderboard') &&
    rhWidgetIds.includes('organizational_overview') &&
    rhWidgetIds.includes('performance_metrics'));
check('RH NO recibe widgets de seguridad/anomalías',
    !rhWidgetIds.includes('security_anomalies') && !rhWidgetIds.includes('audit_log'));

// 1.3 Security
const segDash = await llamar(dashboardController.getDashboard, {
    user: { id: segId, role: 'security' }
});
const segWidgetIds = segDash.cuerpo?.widgets?.map(w => w.id) || [];
check('Security recibe widgets de seguridad y auditoría',
    segWidgetIds.includes('security_anomalies') && segWidgetIds.includes('audit_log'));
check('Security NO recibe widgets de reportes organizacionales de RH',
    !segWidgetIds.includes('organizational_overview') && !segWidgetIds.includes('performance_metrics'));

// 1.4 Admin
const adminDash = await llamar(dashboardController.getDashboard, {
    user: { id: adminId, role: 'admin' }
});
check('Admin recibe todos los widgets disponibles del catalogo',
    adminDash.cuerpo?.widgets?.length === Object.keys(dashboardService.WIDGETS_CATALOG).length);


console.log('\n--- 2. GET /dashboard/widgets/:widgetId Y MENSAJE GENERICO 403 ---');

// 2.1 Security accediendo a su widget
const segWidgetRes = await llamar(dashboardController.getWidget, {
    params: { widgetId: 'security_anomalies' },
    user: { id: segId, role: 'security' }
});
check('Security accede exitosamente a security_anomalies (200 OK)',
    segWidgetRes.estado === 200 && segWidgetRes.cuerpo?.id === 'security_anomalies');

// 2.2 Empleado accediendo a widget no autorizado (anomalies)
const empNoAuthRes = await llamar(dashboardController.getWidget, {
    params: { widgetId: 'security_anomalies' },
    user: { id: empId, role: 'employee' }
});
check('Empleado es rechazado con 403 Forbidden para widget no autorizado', empNoAuthRes.estado === 403);
check('Mensaje generico sin filtrar existencia de widget',
    empNoAuthRes.cuerpo?.msg === 'Acceso denegado o recurso no disponible');

// 2.3 Empleado accediendo a widget inventado que no existe
const empFakeRes = await llamar(dashboardController.getWidget, {
    params: { widgetId: 'widget_fantasma_xyz' },
    user: { id: empId, role: 'employee' }
});
check('Widget inexistente responde 403 Forbidden', empFakeRes.estado === 403);
check('Mismo mensaje generico para no autorizado e inexistente (prevencion de enumeracion)',
    empFakeRes.cuerpo?.msg === empNoAuthRes.cuerpo?.msg);


console.log('\n--- 3. CONFIGURACION PERSONALIZADA (PUT /dashboard/config) ---');

// 3.1 Intento de guardar configuracion con widget no autorizado
const putInvalido = await llamar(dashboardController.saveConfig, {
    body: {
        widgets: [
            { widget_id: 'my_progress', visible: true, order: 1 },
            { widget_id: 'security_anomalies', visible: true, order: 2 } // No permitido para empleado
        ]
    },
    user: { id: empId, role: 'employee' }
});
check('Intento de configurar widget no autorizado es rechazado con 403', putInvalido.estado === 403);

// 3.2 Guardar configuracion valida para empleado (reordenar y ocultar)
const putValido = await llamar(dashboardController.saveConfig, {
    body: {
        widgets: [
            { widget_id: 'leaderboard', visible: true, order: 1 },
            { widget_id: 'my_progress', visible: false, order: 2 }
        ]
    },
    user: { id: empId, role: 'employee' }
});
check('Guardar configuracion valida retorna 200 OK', putValido.estado === 200);

// 3.3 Verificar que el dashboard refleja la configuracion guardada
const empDashConfigurado = await llamar(dashboardController.getDashboard, {
    user: { id: empId, role: 'employee' }
});
check('Dashboard refleja widget oculto (my_progress no aparece)',
    !empDashConfigurado.cuerpo?.widgets?.some(w => w.id === 'my_progress'));
check('Dashboard refleja orden personalizado (leaderboard primero)',
    empDashConfigurado.cuerpo?.widgets[0]?.id === 'leaderboard');

console.log(`\n========================================`);
console.log(`Resumen de pruebas de dashboard: ${ok} pasadas, ${fallos} fallidas.`);
console.log(`========================================\n`);

if (fallos > 0) process.exit(1);
