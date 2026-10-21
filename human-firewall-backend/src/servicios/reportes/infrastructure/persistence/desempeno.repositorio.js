/**
 * Repositorio del reporte de desempeno para RH (servicio de reportes).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): arma y
 * ejecuta las consultas del reporte. El WHERE dinamico (segun los filtros)
 * se construye aca: application/ pasa los filtros ya validados y nunca ve
 * SQL. Lee tablas de identidad y cursos declaradas en el manifiesto; los
 * puntos, niveles e insignias se piden a gamificacion por su contrato.
 */

const db = require('../../../../compartido/config/db');

/** Tablas contra las que se valida la existencia de un id de filtro. */
const TABLA_DE_REFERENCIA = { equipo: 'identidad.teams', curso: 'cursos.courses' };

/** true si existe el equipo o curso con ese id. */
async function existeReferencia(tipo, id) {
    // Nombre de tabla interpolado, pero NO viene del usuario: sale de la
    // constante de arriba. El id, que si viene de afuera, va parametrizado.
    const tabla = TABLA_DE_REFERENCIA[tipo];
    if (!tabla) throw new Error(`referencia desconocida: ${tipo}`);
    const { rows } = await db.query(`SELECT 1 FROM ${tabla} WHERE id = $1`, [id]);
    return rows.length > 0;
}

/**
 * Arma el WHERE de usuarios segun los filtros.
 *
 * El filtro por curso NO limita los puntos a ese curso: selecciona a los
 * usuarios que tienen el curso asignado. Es lo que pide el criterio de
 * aceptacion 1 al hablar de "informacion agregada por curso": RH quiere ver
 * como le va a la gente de ese curso, no cuantos puntos salieron de el.
 *
 * ---------------------------------------------------------------------
 * Que hace el filtro de fechas
 * ---------------------------------------------------------------------
 * Restringe QUE USUARIOS aparecen, no solo sus numeros: solo entran los que
 * tuvieron actividad dentro del rango.
 *
 * La alternativa era dejar a todos y mostrarles 0 puntos en el periodo. Se
 * descarto por dos motivos. Primero, el criterio de aceptacion 2 dice
 * "mostrando solo los datos que cumplen esos filtros"; una fila de alguien
 * que no hizo nada en enero no es un dato de enero. Segundo, con esa lectura
 * el estado vacio que pide el mismo criterio era practicamente inalcanzable:
 * consultar un mes sin actividad devolvia la plantilla entera con ceros, que
 * es ruido y no una respuesta.
 *
 * Para lo contrario -- ver quien esta inactivo -- se consulta sin filtro de
 * fechas: ahi aparecen todos, con su columna de ultima actividad.
 */
function construirFiltroUsuarios(filtros) {
    const condiciones = ['u.is_active = true'];
    const params = [];

    if (filtros.teamId) {
        params.push(filtros.teamId);
        condiciones.push(`u.team_id = $${params.length}`);
    }

    if (filtros.courseId) {
        params.push(filtros.courseId);
        condiciones.push(
            `EXISTS (SELECT 1 FROM cursos.course_assignments ca
                      WHERE ca.user_id = u.id AND ca.course_id = $${params.length})`
        );
    }

    if (filtros.from || filtros.to) {
        params.push(filtros.from, filtros.to);
        const iFrom = params.length - 1;
        const iTo = params.length;

        // Las tres fuentes de actividad, igual que en obtenerUltimaActividad:
        // alguien pudo completar lecciones o reprobar evaluaciones sin sumar
        // un solo punto, y eso sigue siendo actividad del periodo.
        const enRango = (tabla, columna) => `
            EXISTS (SELECT 1 FROM ${tabla} x
                     WHERE x.user_id = u.id
                       AND ($${iFrom}::timestamptz IS NULL OR x.${columna} >= $${iFrom}::timestamptz)
                       AND ($${iTo}::timestamptz IS NULL OR x.${columna} < ($${iTo}::timestamptz + interval '1 day')))`;

        condiciones.push(`(
            ${enRango('gamificacion.points_ledger', 'created_at')}
            OR ${enRango('evaluaciones.quiz_attempts', 'created_at')}
            OR ${enRango('cursos.lesson_progress', 'completed_at')}
        )`);
    }

    return { where: condiciones.join(' AND '), params };
}

/** Cuantos usuarios entran en el reporte con estos filtros. */
async function contarUsuarios(filtros) {
    const { where, params } = construirFiltroUsuarios(filtros);
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total FROM identidad.users u WHERE ${where}`,
        params
    );
    return rows[0].total;
}

/**
 * Pagina de usuarios del reporte. Orden estable: sin el desempate por id, dos
 * usuarios con los mismos puntos podrian intercambiarse entre paginas.
 */
async function usuariosDePagina(filtros, { limit, offset }) {
    const { where, params } = construirFiltroUsuarios(filtros);
    const { rows } = await db.query(
        `SELECT u.id, u.email, u.role, u.team_id, t.name AS equipo, u.created_at
           FROM identidad.users u
           LEFT JOIN identidad.teams t ON t.id = u.team_id
          WHERE ${where}
          ORDER BY u.total_points DESC, u.id ASC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
    );
    return rows;
}

/**
 * Ultima actividad de cada usuario: el maximo entre el ultimo movimiento de
 * puntos, el ultimo intento de evaluacion y la ultima leccion completada.
 */
async function ultimaActividad(userIds) {
    const { rows } = await db.query(
        `SELECT user_id, MAX(momento) AS ultima FROM (
             SELECT user_id, created_at   AS momento FROM gamificacion.points_ledger   WHERE user_id = ANY($1::int[])
             UNION ALL
             SELECT user_id, created_at   AS momento FROM evaluaciones.quiz_attempts   WHERE user_id = ANY($1::int[])
             UNION ALL
             SELECT user_id, completed_at AS momento FROM cursos.lesson_progress WHERE user_id = ANY($1::int[])
         ) actividad
         GROUP BY user_id`,
        [userIds]
    );
    return rows;
}

/**
 * Agregado por equipo sobre TODOS los usuarios del filtro. Los puntos se
 * suman desde points_ledger y no desde users.total_points porque esa columna
 * es una cache del historial COMPLETO: con un filtro de fechas mentiria.
 */
async function agregadoPorEquipo(filtros) {
    const { where, params } = construirFiltroUsuarios(filtros);
    const idxFrom = params.length + 1;
    const idxTo = params.length + 2;
    const { rows } = await db.query(
        `SELECT COALESCE(t.name, 'Sin equipo') AS equipo,
                t.id                            AS team_id,
                COUNT(DISTINCT u.id)::int       AS usuarios,
                COALESCE(SUM(pl.points), 0)::int AS puntos,
                ROUND(COALESCE(SUM(pl.points), 0)::numeric
                      / NULLIF(COUNT(DISTINCT u.id), 0), 1)::float AS promedio_puntos
           FROM identidad.users u
           LEFT JOIN identidad.teams t ON t.id = u.team_id
           LEFT JOIN gamificacion.points_ledger pl
                  ON pl.user_id = u.id
                 AND ($${idxFrom}::timestamptz IS NULL OR pl.created_at >= $${idxFrom}::timestamptz)
                 AND ($${idxTo}::timestamptz IS NULL OR pl.created_at < ($${idxTo}::timestamptz + interval '1 day'))
          WHERE ${where}
          GROUP BY t.id, t.name
          ORDER BY puntos DESC`,
        [...params, filtros.from, filtros.to]
    );
    return rows;
}

/** Agregado por curso: usuarios asignados y cuantos lo completaron. */
async function agregadoPorCurso(filtros) {
    const { where, params } = construirFiltroUsuarios(filtros);
    const { rows } = await db.query(
        `SELECT c.id AS course_id, c.title AS curso,
                COUNT(DISTINCT u.id)::int AS usuarios,
                COUNT(DISTINCT CASE WHEN ca.status = 'completed' THEN u.id END)::int AS completados
           FROM identidad.users u
           JOIN cursos.course_assignments ca ON ca.user_id = u.id
           JOIN cursos.courses c ON c.id = ca.course_id
          WHERE ${where}
          GROUP BY c.id, c.title
          ORDER BY usuarios DESC, c.title`,
        params
    );
    return rows;
}

/** Equipos activos, para el panel de filtros. */
async function equiposActivos() {
    const { rows } = await db.query(`SELECT id, name FROM identidad.teams WHERE is_active = true ORDER BY name`);
    return rows;
}

/** Cursos, para el panel de filtros. */
async function cursos() {
    const { rows } = await db.query(`SELECT id, title FROM cursos.courses ORDER BY title`);
    return rows;
}

module.exports = {
    existeReferencia,
    contarUsuarios,
    usuariosDePagina,
    ultimaActividad,
    agregadoPorEquipo,
    agregadoPorCurso,
    equiposActivos,
    cursos
};
