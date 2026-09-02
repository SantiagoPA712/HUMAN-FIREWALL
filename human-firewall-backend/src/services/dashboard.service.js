/**
 * Servicio de Dashboard Centralizado.
 *
 * Compone dinamicamente los widgets autorizados para el rol del usuario
 * reutilizando los servicios existentes de reportes, anomalias y auditoria.
 */

const db = require('../config/db');
const permissionService = require('./permission.service');
const reportsService = require('./reports.service');
const anomaliesService = require('./anomalies.service');
const auditService = require('./audit.service');
const levelsService = require('./levels.service');
const rewardsService = require('./rewards.service');

const DEFAULT_POLLING_INTERVAL_SECONDS = parseInt(process.env.DASHBOARD_POLLING_INTERVAL_SECONDS, 10) || 300;

/**
 * Catalogo de widgets del sistema vinculados a recursos de report_permissions.
 */
const WIDGETS_CATALOG = {
    my_progress: {
        id: 'my_progress',
        title: 'Mi Progreso y Nivel',
        resource: 'dashboard',
        action: 'view',
        loader: async (userId) => {
            const [nivel, insignias] = await Promise.all([
                levelsService.obtenerNivelDeUsuario(userId),
                rewardsService.obtenerRecompensasDeUsuario(userId)
            ]);
            return { nivel, insignias };
        }
    },
    leaderboard: {
        id: 'leaderboard',
        title: 'Tabla de Clasificación',
        resource: 'dashboard',
        action: 'view',
        loader: async () => {
            const { rows } = await db.query(
                `SELECT u.id, u.email, u.total_points, u.level, t.name as team_name
                   FROM users u
              LEFT JOIN teams t ON t.id = u.team_id
                  WHERE u.is_active = true
                  ORDER BY u.total_points DESC, u.id ASC
                  LIMIT 10`
            );
            return rows;
        }
    },
    organizational_overview: {
        id: 'organizational_overview',
        title: 'Resumen Organizacional',
        resource: 'organizational',
        action: 'view',
        loader: async () => {
            return await reportsService.obtenerOpcionesDeFiltro();
        }
    },
    performance_metrics: {
        id: 'performance_metrics',
        title: 'Métricas de Desempeño RH',
        resource: 'performance',
        action: 'view',
        loader: async () => {
            const reporte = await reportsService.obtenerReporteDesempeno({}, { page: 1, pageSize: 5 });
            return {
                agregados: reporte.agregados,
                total_usuarios: reporte.paginacion.total,
                muestra: reporte.resultados
            };
        }
    },
    security_anomalies: {
        id: 'security_anomalies',
        title: 'Alertas de Seguridad y Anomalías',
        resource: 'anomalies',
        action: 'view',
        loader: async () => {
            const [resumen, { resultados }] = await Promise.all([
                anomaliesService.obtenerResumen(),
                anomaliesService.listarAnomalias({ page: 1, pageSize: 5 })
            ]);
            return {
                resumen,
                ultimas_anomalias: resultados
            };
        }
    },
    audit_log: {
        id: 'audit_log',
        title: 'Registro de Auditoría de Seguridad',
        resource: 'anomalies',
        action: 'view',
        loader: async () => {
            const log = await auditService.listar({ page: 1, pageSize: 5 });
            return log.resultados;
        }
    }
};

/**
 * Obtiene la configuracion personalizada de widgets de un usuario.
 */
async function getUserDashboardConfig(userId) {
    const { rows } = await db.query(
        `SELECT widgets FROM dashboard_configs WHERE user_id = $1`,
        [userId]
    );
    return rows.length > 0 ? rows[0].widgets : null;
}

/**
 * Construye el dashboard completo filtrando los widgets segun el rol del usuario en backend.
 */
async function getDashboardForUser({ userId, role }) {
    const userRole = role || 'employee';

    // 1. Filtrar widgets autorizados para este rol antes de consultar datos
    const widgetsAutorizados = [];
    for (const [widgetId, def] of Object.entries(WIDGETS_CATALOG)) {
        const allowed = await permissionService.hasPermission(userRole, def.resource, def.action);
        if (allowed) {
            widgetsAutorizados.push(def);
        }
    }

    // 2. Cargar configuracion de orden y visibilidad del usuario
    const userConfig = await getUserDashboardConfig(userId);
    const configMap = new Map();
    if (Array.isArray(userConfig)) {
        userConfig.forEach(c => configMap.set(c.widget_id, c));
    }

    // 3. Aplicar orden y visibilidad
    const widgetsAProcesar = [];
    for (let i = 0; i < widgetsAutorizados.length; i++) {
        const def = widgetsAutorizados[i];
        const pref = configMap.get(def.id);

        if (pref && pref.visible === false) {
            continue; // Usuario eligio ocultarlo
        }

        const orden = pref?.order !== undefined ? pref.order : (i + 1);
        widgetsAProcesar.push({ def, order: orden });
    }

    widgetsAProcesar.sort((a, b) => a.order - b.order);

    // 4. Cargar datos de los widgets autorizados llamando a los servicios existentes
    const widgetsCargados = await Promise.all(
        widgetsAProcesar.map(async ({ def, order }) => {
            try {
                const data = await def.loader(userId);
                return {
                    id: def.id,
                    title: def.title,
                    resource: def.resource,
                    order,
                    data
                };
            } catch (err) {
                console.warn(`[dashboardService] Error cargando widget ${def.id}:`, err.message);
                return {
                    id: def.id,
                    title: def.title,
                    resource: def.resource,
                    order,
                    data: null,
                    error: "No se pudieron cargar los datos de este widget"
                };
            }
        })
    );

    return {
        polling_interval_seconds: DEFAULT_POLLING_INTERVAL_SECONDS,
        total_widgets: widgetsCargados.length,
        widgets: widgetsCargados
    };
}

/**
 * Obtiene los datos de un widget especifico.
 * Si no existe o no esta autorizado para el rol, responde con error generico (sin distinguir).
 */
async function getWidgetDataForUser({ userId, role, widgetId }) {
    const userRole = role || 'employee';
    const def = WIDGETS_CATALOG[widgetId];

    // Mismo mensaje generico tanto si el widget no existe como si no esta autorizado
    if (!def) {
        const error = new Error("Acceso denegado o recurso no disponible");
        error.status = 403;
        throw error;
    }

    const allowed = await permissionService.hasPermission(userRole, def.resource, def.action);
    if (!allowed) {
        const error = new Error("Acceso denegado o recurso no disponible");
        error.status = 403;
        throw error;
    }

    const data = await def.loader(userId);
    return {
        id: def.id,
        title: def.title,
        resource: def.resource,
        data
    };
}

/**
 * Guarda la configuracion de widgets del usuario validando que todos correspondan a su rol.
 */
async function saveUserDashboardConfig({ userId, role, widgets }) {
    if (!Array.isArray(widgets)) {
        const error = new Error("El campo 'widgets' debe ser un arreglo");
        error.status = 400;
        throw error;
    }

    const userRole = role || 'employee';

    // Validar que cada widget solicitado este permitido para el rol del usuario
    for (const w of widgets) {
        const def = WIDGETS_CATALOG[w.widget_id];
        if (!def) {
            const error = new Error(`Widget invalido o no disponible: ${w.widget_id}`);
            error.status = 403;
            throw error;
        }

        const allowed = await permissionService.hasPermission(userRole, def.resource, def.action);
        if (!allowed) {
            const error = new Error(`El rol no tiene autorizacion para configurar el widget: ${w.widget_id}`);
            error.status = 403;
            throw error;
        }
    }

    const { rows } = await db.query(
        `INSERT INTO dashboard_configs (user_id, widgets, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id)
         DO UPDATE SET widgets = $2, updated_at = now()
         RETURNING user_id, widgets, updated_at`,
        [userId, JSON.stringify(widgets)]
    );

    return rows[0];
}

module.exports = {
    WIDGETS_CATALOG,
    DEFAULT_POLLING_INTERVAL_SECONDS,
    getDashboardForUser,
    getWidgetDataForUser,
    getUserDashboardConfig,
    saveUserDashboardConfig
};
