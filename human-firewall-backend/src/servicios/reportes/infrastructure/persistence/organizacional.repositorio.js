/**
 * Repositorio del reporte organizacional (servicio de reportes).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): los snapshots
 * org_kpi_snapshots y la bitacora de consultas. Los KPIs se calculan en
 * application/ con los contratos de identidad, gamificacion, evaluaciones y
 * cursos: cada uno tiene su propia base.
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('./conexion');

const q = (tx) => tx || db;

/** Guarda un snapshot de KPI (historial: no se pisa). */
async function insertarSnapshot(periodo, m) {
    return db.query(
            `INSERT INTO reportes.org_kpi_snapshots (period, area_id, kpi_type, value, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [periodo, m.areaId, m.kpi, m.valor, JSON.stringify(m.metadata || {})]
        );
}

/** Ultimo snapshot de cada KPI para un periodo y area. */
async function snapshotsDe(periodo, areaId) {
    const { rows } = await db.query(
        `SELECT DISTINCT ON (kpi_type)
                kpi_type, value, metadata, calculated_at
           FROM reportes.org_kpi_snapshots
          WHERE period = $1 AND area_id IS NOT DISTINCT FROM $2
          ORDER BY kpi_type, calculated_at DESC, id DESC`,
        [periodo, areaId]
    );
    return rows;
}

/** Ultimos N periodos de un KPI, del mas nuevo al mas viejo. */
async function tendenciaDe(kpi, areaId, hastaPeriodo, limite) {
    const { rows } = await db.query(
        `SELECT DISTINCT ON (period) period, value, calculated_at
           FROM reportes.org_kpi_snapshots
          WHERE kpi_type = $1
            AND area_id IS NOT DISTINCT FROM $2
            AND period <= $3
          ORDER BY period DESC, calculated_at DESC, id DESC
          LIMIT $4`,
        [kpi, areaId, hastaPeriodo, limite]
    );
    return rows;
}

/** Bitacora de consultas del reporte organizacional. */
async function registrarConsulta(userId, periodo, compararCon, areaId, parametros) {
    return db.query(
        `INSERT INTO reportes.org_report_access_log
            (requested_by, period, compare_to, area_id, params)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, periodo, compararCon, areaId ?? null, JSON.stringify(parametros)]
    );
}

module.exports = {
    insertarSnapshot,
    snapshotsDe,
    tendenciaDe,
    registrarConsulta
};
