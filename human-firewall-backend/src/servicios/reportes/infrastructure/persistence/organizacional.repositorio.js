/**
 * Repositorio del reporte organizacional (servicio de reportes).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): calculo de
 * KPIs por area (participacion, cursos, engagement), los snapshots
 * org_kpi_snapshots y la bitacora de consultas. Lee tablas de identidad,
 * gamificacion, evaluaciones y cursos declaradas en el manifiesto.
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/**
 * Condicion "tuvo actividad en el rango".
 *
 * Las tres fuentes, igual que en reports.service: alguien pudo completar
 * lecciones o reprobar evaluaciones sin sumar un solo punto, y eso sigue
 * siendo participacion.
 */
const TUVO_ACTIVIDAD = `(
    EXISTS (SELECT 1 FROM points_ledger p
             WHERE p.user_id = u.id AND p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz)
 OR EXISTS (SELECT 1 FROM quiz_attempts q
             WHERE q.user_id = u.id AND q.created_at >= $1::timestamptz AND q.created_at < $2::timestamptz)
 OR EXISTS (SELECT 1 FROM lesson_progress l
             WHERE l.user_id = u.id AND l.completed_at >= $1::timestamptz AND l.completed_at < $2::timestamptz)
)`;

/**
 * GROUPING SETS: una sola pasada devuelve las filas por area Y la fila del
 * total de la organizacion.
 *
 * La alternativa era correr cada consulta dos veces (una agrupada, otra sin
 * agrupar) y arriesgar que el total no coincidiera con la suma de las partes
 * si algo cambiaba entre una y otra.
 *
 * GROUPING(u.team_id) vale 1 en la fila del total. Hace falta porque en esa
 * fila team_id tambien es NULL, igual que en la de las personas sin area: sin
 * este desempate serian indistinguibles.
 */
const AGRUPACION = `GROUP BY GROUPING SETS ((u.team_id), ())`;


/** Padron y usuarios activos en el rango, por area y total de la organizacion (GROUPING SETS). */
async function participacionPorArea(inicio, fin) {
    const { rows } = await db.query(
        `SELECT u.team_id AS area_id,
                GROUPING(u.team_id)::int AS total_org,
                COUNT(*)::int AS padron,
                COUNT(*) FILTER (WHERE ${TUVO_ACTIVIDAD})::int AS activos
           FROM users u
          WHERE u.is_active = true
          ${AGRUPACION}`,
        [inicio, fin]
    );
    return rows;
}

/** Puntos acumulados de cada usuario activo hasta una fecha, con su area. */
async function puntosPorUsuarioHasta(fin) {
    return db.query(
            `SELECT u.id, u.team_id,
                    COALESCE(SUM(pl.points), 0)::int AS puntos
               FROM users u
               LEFT JOIN points_ledger pl
                      ON pl.user_id = u.id AND pl.created_at < $1::timestamptz
              WHERE u.is_active = true
              GROUP BY u.id, u.team_id`,
            [fin]
        );
}

/** Cursos completados en el rango, por area y total. */
async function cursosCompletadosPorArea(inicio, fin) {
    const { rows } = await db.query(
        `SELECT u.team_id AS area_id,
                GROUPING(u.team_id)::int AS total_org,
                COUNT(ca.id)::int AS cursos,
                COUNT(DISTINCT ca.user_id)::int AS personas
           FROM users u
           LEFT JOIN course_assignments ca
                  ON ca.user_id = u.id
                 AND ca.status = 'completed'
                 AND ca.completed_at >= $1::timestamptz
                 AND ca.completed_at <  $2::timestamptz
          WHERE u.is_active = true
          ${AGRUPACION}`,
        [inicio, fin]
    );
    return rows;
}

/** Usuarios con alguna accion en el rango sobre el padron, por area y total. */
async function engagementPorArea(inicio, fin) {
    const { rows } = await db.query(
        `WITH acciones AS (
             SELECT user_id FROM points_ledger
              WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
             UNION ALL
             SELECT user_id FROM quiz_attempts
              WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
             UNION ALL
             SELECT user_id FROM lesson_progress
              WHERE completed_at >= $1::timestamptz AND completed_at < $2::timestamptz
         )
         SELECT u.team_id AS area_id,
                GROUPING(u.team_id)::int AS total_org,
                COUNT(a.user_id)::int    AS acciones,
                COUNT(DISTINCT u.id)::int AS padron
           FROM users u
           LEFT JOIN acciones a ON a.user_id = u.id
          WHERE u.is_active = true
          ${AGRUPACION}`,
        [inicio, fin]
    );
    return rows;
}

/** Guarda un snapshot de KPI (historial: no se pisa). */
async function insertarSnapshot(periodo, m) {
    return db.query(
            `INSERT INTO org_kpi_snapshots (period, area_id, kpi_type, value, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [periodo, m.areaId, m.kpi, m.valor, JSON.stringify(m.metadata || {})]
        );
}

/** Ultimo snapshot de cada KPI para un periodo y area. */
async function snapshotsDe(periodo, areaId) {
    const { rows } = await db.query(
        `SELECT DISTINCT ON (kpi_type)
                kpi_type, value, metadata, calculated_at
           FROM org_kpi_snapshots
          WHERE period = $1 AND area_id IS NOT DISTINCT FROM $2
          ORDER BY kpi_type, calculated_at DESC, id DESC`,
        [periodo, areaId]
    );
    return rows;
}

/** Area (equipo) por id. */
async function buscarArea(id) {
    const { rows } = await db.query(
        'SELECT id, name, is_active FROM teams WHERE id = $1',
        [id]
    );
    return rows;
}

/** Areas (equipos) activas. */
async function areasActivas() {
    const { rows } = await db.query(
        'SELECT id, name FROM teams WHERE is_active = true ORDER BY name'
    );
    return rows;
}

/** Ultimos N periodos de un KPI, del mas nuevo al mas viejo. */
async function tendenciaDe(kpi, areaId, hastaPeriodo, limite) {
    const { rows } = await db.query(
        `SELECT DISTINCT ON (period) period, value, calculated_at
           FROM org_kpi_snapshots
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
        `INSERT INTO org_report_access_log
            (requested_by, period, compare_to, area_id, params)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, periodo, compararCon, areaId ?? null, JSON.stringify(parametros)]
    );
}

module.exports = {
    participacionPorArea,
    puntosPorUsuarioHasta,
    cursosCompletadosPorArea,
    engagementPorArea,
    insertarSnapshot,
    snapshotsDe,
    buscarArea,
    areasActivas,
    tendenciaDe,
    registrarConsulta
};
