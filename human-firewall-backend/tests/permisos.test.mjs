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
    '031_report_permissions'
];

for (const f of migraciones) {
    try {
        await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8'));
    } catch (e) {
        console.log(`ERROR en ${f}: ${msg(e)}`);
        fallos++;
    }
}
console.log('Migraciones aplicadas con exito (incluyendo 031_report_permissions.sql)\n');

const permService = require_('./services/permission.service');
const permController = require_('./controllers/permission.controller');
const { requireRoles } = require_('./middlewares/role.middleware');

const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;

const adminId = await idDe('admin@humanfirewall.com');
const rhId = await idDe('rh@humanfirewall.com');
const segId = await idDe('seguridad@humanfirewall.com');

await pg.exec(`
    INSERT INTO users (email, password, role) VALUES
    ('empleado.test@hf.com', 'hash', 'employee');
`);
const empId = await idDe('empleado.test@hf.com');

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

/** Helper para middleware requireRoles */
const probarMiddleware = (rolesPermitidos, user) => {
    let estado = 200, cuerpo = null, llamadoNext = false;
    const middleware = requireRoles(rolesPermitidos);
    const req = { user };
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    middleware(req, res, () => { llamadoNext = true; });
    return { llamadoNext, estado, cuerpo };
};

console.log('--- 1. CONTROL DE ACCESO RBAC (SOLO ADMIN) ---');

const mwEmpleado = probarMiddleware(['admin'], { id: empId, role: 'empleado' });
check('empleado es rechazado con 403 por requireRoles', mwEmpleado.estado === 403 && !mwEmpleado.llamadoNext);

const mwRH = probarMiddleware(['admin'], { id: rhId, role: 'rh' });
check('rh es rechazado con 403 por requireRoles', mwRH.estado === 403 && !mwRH.llamadoNext);

const mwSeg = probarMiddleware(['admin'], { id: segId, role: 'security' });
check('seguridad es rechazado con 403 por requireRoles', mwSeg.estado === 403 && !mwSeg.llamadoNext);

const mwAdmin = probarMiddleware(['admin'], { id: adminId, role: 'admin' });
check('admin es autorizado por requireRoles', mwAdmin.llamadoNext === true);


console.log('\n--- 2. CREACION / MODIFICACION DE PERMISOS Y HISTORIAL TRANSACCIONAL ---');

// 2.1 POST crear permiso
const postRes = await llamar(permController.createPermission, {
    body: {
        role: 'instructor',
        resource: 'anomalies',
        action: 'export',
        allowed: true
    },
    user: { id: adminId, role: 'admin' }
});

check('POST /permissions retorna 201 Created', postRes.estado === 201);
check('Permiso creado correctamente', postRes.cuerpo?.permission?.role === 'instructor');

// Verificar insercion en historial
const { rows: hist1 } = await pg.query(
    'SELECT * FROM report_permissions_history WHERE resource = $1 AND action = $2 ORDER BY timestamp DESC',
    ['anomalies', 'export']
);
const ultimoHist = hist1.find(h => h.changed_by === adminId && h.new_value?.role === 'instructor');
check('Historial insertado en la misma transaccion', !!ultimoHist);
check('Historial previo era null al crear', ultimoHist?.previous_value === null);
check('Historial nuevo contiene los datos guardados', ultimoHist?.new_value?.allowed === true);

// 2.2 PATCH modificar permiso
const patchRes = await llamar(permController.updatePermission, {
    body: {
        role: 'instructor',
        resource: 'anomalies',
        action: 'export',
        allowed: false
    },
    user: { id: adminId, role: 'admin' }
});

check('PATCH /permissions retorna 200 OK', patchRes.estado === 200);
check('Permiso modificado a allowed=false', patchRes.cuerpo?.permission?.allowed === false);

const { rows: hist2 } = await pg.query(
    'SELECT * FROM report_permissions_history WHERE resource = $1 AND action = $2 ORDER BY id DESC LIMIT 1',
    ['anomalies', 'export']
);
check('Historial registra previous_value (true) y new_value (false)',
    hist2[0]?.previous_value?.allowed === true && hist2[0]?.new_value?.allowed === false);

// 2.3 DELETE eliminar permiso
const deleteRes = await llamar(permController.deletePermission, {
    body: {
        role: 'instructor',
        resource: 'anomalies',
        action: 'export'
    },
    user: { id: adminId, role: 'admin' }
});

check('DELETE /permissions retorna 200 OK', deleteRes.estado === 200);

const { rows: hist3 } = await pg.query(
    'SELECT * FROM report_permissions_history WHERE resource = $1 AND action = $2 ORDER BY id DESC LIMIT 1',
    ['anomalies', 'export']
);
check('Historial registra eliminacion con new_value null',
    hist3[0]?.new_value === null && hist3[0]?.previous_value?.role === 'instructor');


console.log('\n--- 3. INMUTABILIDAD DEL HISTORIAL (TRIGGER DE BD) ---');

let triggerFalloUpdate = false;
try {
    await pg.query('UPDATE report_permissions_history SET resource = $1 WHERE id = $2', ['hack', hist3[0].id]);
} catch (e) {
    triggerFalloUpdate = true;
}
check('UPDATE directo sobre report_permissions_history es rechazado por el trigger inmutable', triggerFalloUpdate);

let triggerFalloDelete = false;
try {
    await pg.query('DELETE FROM report_permissions_history WHERE id = $1', [hist3[0].id]);
} catch (e) {
    triggerFalloDelete = true;
}
check('DELETE directo sobre report_permissions_history es rechazado por el trigger inmutable', triggerFalloDelete);


console.log('\n--- 4. GET /permissions/history (PAGINADO Y ORDEN DESCENDENTE) ---');

const histRes = await llamar(permController.getPermissionHistory, {
    query: { page: 1, limit: 10 },
    user: { id: adminId, role: 'admin' }
});

check('GET /permissions/history retorna 200 OK', histRes.estado === 200);
check('Retorna paginacion estructurada (total, page, limit, totalPages, data)',
    histRes.cuerpo?.total >= 3 && histRes.cuerpo?.page === 1 && Array.isArray(histRes.cuerpo?.data));
check('Historial ordenado por timestamp descendente',
    new Date(histRes.cuerpo?.data[0]?.timestamp) >= new Date(histRes.cuerpo?.data[1]?.timestamp));


console.log('\n--- 5. MIDDLEWARE requireReportPermission Y AUDITORIA SINCRONA ---');

const { requireReportPermission } = require_('./middlewares/reportPermission.middleware');

// Helper para ejecutar middleware de reporte
const probarReportMiddleware = async (resource, action, user, method = 'GET', url = '/') => {
    let estado = 200, cuerpo = null, llamadoNext = false;
    const req = { user, method, url, originalUrl: url };
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    const middleware = requireReportPermission(resource, action);
    await middleware(req, res, () => { llamadoNext = true; });
    return { llamadoNext, estado, cuerpo };
};

// 5.1 Intento de acceso permitido (RH a performance view)
const resPermitido = await probarReportMiddleware('performance', 'view', { id: rhId, role: 'rh' });
check('RH tiene permitido performance/view y llama a next()', resPermitido.llamadoNext === true && resPermitido.estado === 200);

// 5.2 Intento de acceso denegado (Empleado a anomalies view)
const resDenegado = await probarReportMiddleware('anomalies', 'view', { id: empId, role: 'employee' });
check('Empleado es rechazado con 403 por requireReportPermission', resDenegado.estado === 403 && !resDenegado.llamadoNext);

// 5.3 Verificar registro sincronico en audit log
const { rows: deniedLogs } = await pg.query(
    'SELECT * FROM permission_audit_log WHERE user_id = $1 AND resource = $2 AND action = $3 AND result = $4',
    [empId, 'anomalies', 'view', 'denied']
);
check('El intento denegado quedo insertado sincronamente en permission_audit_log', deniedLogs.length > 0);


console.log('\n--- 6. INVALIDACION INMEDIATA DE CACHE ---');

// Consultar para calentar la cache
const permitidoAntes = await permService.hasPermission('rh', 'performance', 'export');
check('RH tiene permitido performance/export antes de modificar', permitidoAntes === true);

// Desactivar permiso de exportacion para RH
await permService.savePermission({
    role: 'rh',
    resource: 'performance',
    action: 'export',
    allowed: false,
    changedBy: adminId
});

// El middleware debe denegar inmediatamente gracias a la invalidacion de cache
const resDespuesDeInvalidar = await probarReportMiddleware('performance', 'export', { id: rhId, role: 'rh' });
check('Tras modificar el permiso, el middleware rechaza inmediatamente con 403',
    resDespuesDeInvalidar.estado === 403 && !resDespuesDeInvalidar.llamadoNext);

// Restaurar permiso
await permService.savePermission({
    role: 'rh',
    resource: 'performance',
    action: 'export',
    allowed: true,
    changedBy: adminId
});

const resRestaurado = await probarReportMiddleware('performance', 'export', { id: rhId, role: 'rh' });
check('Al restaurar el permiso, el middleware vuelve a permitir el acceso',
    resRestaurado.llamadoNext === true);


console.log(`\n========================================`);
console.log(`Resumen de pruebas de permisos: ${ok} pasadas, ${fallos} fallidas.`);
console.log(`========================================\n`);

if (fallos > 0) process.exit(1);
