/**
 * Reportes de desempeno para RH.
 *
 * HU: "quiero ver reportes de desempeno de los usuarios basados en puntos,
 * niveles e insignias, para identificar tendencias y detectar necesidades de
 * refuerzo".
 *
 * ---------------------------------------------------------------------
 * Criterio tecnico 3: no duplicar logica de negocio
 * ---------------------------------------------------------------------
 * Este modulo NO sabe cuantos puntos vale una leccion, ni en que puntaje
 * empieza el nivel 3, ni que condicion desbloquea una insignia. Todo eso se
 * le pide a quien ya lo sabe:
 *
 *   puntos    -> points.service.obtenerTotalesPorUsuarios()  (points_ledger)
 *   nivel     -> levels.service.calcularProgreso()           (levels_config)
 *   insignias -> rewards.service.obtenerResumenPorUsuarios() (user_rewards)
 *
 * El detalle que hace que esto funcione sin volverse lento:
 * `calcularProgreso` es una funcion PURA. Se pide la escalera de niveles una
 * sola vez y se aplica en memoria a los 50 usuarios de la pagina, en lugar de
 * llamar a obtenerNivelDeUsuario() cincuenta veces. Se reutiliza la regla sin
 * pagar N+1 consultas.
 *
 * Si manana cambian los umbrales de nivel o las reglas de puntuacion, este
 * archivo no se toca.
 */

const db = require('../config/db');
const pointsService = require('./points.service');
const levelsService = require('./levels.service');
const rewardsService = require('./rewards.service');

/** Tamano de pagina por defecto (criterio tecnico 4). */
const PAGE_SIZE_POR_DEFECTO = 50;
const PAGE_SIZE_MAXIMO = 200;

// ---------------------------------------------------------------------
// Validacion de filtros (criterio tecnico 2)
// ---------------------------------------------------------------------

/** Fecha ISO 8601 en formato YYYY-MM-DD, y que sea una fecha real. */
function esFechaISO(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

    // El regex acepta 2026-02-31. Date lo normaliza a marzo, asi que se
    // compara el resultado contra la entrada para detectar el desborde.
    const fecha = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

/**
 * Valida los filtros ANTES de tocar la tabla de datos.
 *
 * Criterio tecnico 2: si algo es invalido se responde 400 con el detalle del
 * campo y no se ejecuta la consulta del reporte.
 *
 * La existencia de team_id y course_id se verifica contra la base. Eso es una
 * consulta, pero de validacion: sin ella, un id inexistente devolveria un
 * reporte vacio y RH no podria distinguir "este equipo no tiene actividad" de
 * "escribi mal el id", que es exactamente la confusion que el criterio 2
 * quiere evitar al pedir un estado vacio claro para un filtro valido.
 *
 * @returns {Promise<{errores: Array<{campo: string, detalle: string}>, filtros: object}>}
 */
async function validarFiltros(query = {}) {
    const errores = [];
    const filtros = { from: null, to: null, teamId: null, courseId: null };

    for (const campo of ['from', 'to']) {
        const valor = query[campo];
        if (valor === undefined || valor === null || valor === '') continue;

        if (!esFechaISO(valor)) {
            errores.push({
                campo,
                detalle: `Formato invalido. Se espera una fecha ISO 8601 (YYYY-MM-DD), se recibio "${valor}".`
            });
        } else {
            filtros[campo] = valor;
        }
    }

    // Un rango invertido no es un error de formato, pero devolveria siempre
    // vacio y el usuario no sabria por que.
    if (filtros.from && filtros.to && filtros.from > filtros.to) {
        errores.push({
            campo: 'from',
            detalle: `La fecha inicial (${filtros.from}) es posterior a la final (${filtros.to}).`
        });
    }

    const referencias = [
        { campo: 'team_id', clave: 'teamId', tabla: 'teams', etiqueta: 'equipo' },
        { campo: 'course_id', clave: 'courseId', tabla: 'courses', etiqueta: 'curso' }
    ];

    for (const ref of referencias) {
        const valor = query[ref.campo];
        if (valor === undefined || valor === null || valor === '') continue;

        const id = Number(valor);
        if (!Number.isInteger(id) || id <= 0) {
            errores.push({
                campo: ref.campo,
                detalle: `Debe ser un entero positivo, se recibio "${valor}".`
            });
            continue;
        }

        // Nombre de tabla interpolado, pero NO viene del usuario: sale de la
        // constante `referencias` de arriba. El id, que si viene de afuera,
        // va parametrizado.
        const { rows } = await db.query(`SELECT 1 FROM ${ref.tabla} WHERE id = $1`, [id]);
        if (rows.length === 0) {
            errores.push({
                campo: ref.campo,
                detalle: `No existe ningun ${ref.etiqueta} con id ${id}.`
            });
        } else {
            filtros[ref.clave] = id;
        }
    }

    return { errores, filtros };
}

/** Normaliza la paginacion (criterio tecnico 4). */
function normalizarPaginacion(query = {}) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pedido = Number.parseInt(query.page_size, 10) || PAGE_SIZE_POR_DEFECTO;
    const pageSize = Math.min(PAGE_SIZE_MAXIMO, Math.max(1, pedido));
    return { page, pageSize };
}

// ---------------------------------------------------------------------
// Consulta base
// ---------------------------------------------------------------------

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
            `EXISTS (SELECT 1 FROM course_assignments ca
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
            ${enRango('points_ledger', 'created_at')}
            OR ${enRango('quiz_attempts', 'created_at')}
            OR ${enRango('lesson_progress', 'completed_at')}
        )`);
    }

    return { where: condiciones.join(' AND '), params };
}

/** Cuantos usuarios entran en el reporte con estos filtros. */
async function contarUsuarios(filtros) {
    const { where, params } = construirFiltroUsuarios(filtros);
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total FROM users u WHERE ${where}`,
        params
    );
    return rows[0].total;
}

/**
 * Ultima actividad de cada usuario.
 *
 * "Ultima actividad" no vive en ninguna columna: es el maximo entre el ultimo
 * movimiento de puntos, el ultimo intento de evaluacion y la ultima leccion
 * completada. Un usuario puede haber leido lecciones sin sumar puntos, o
 * haber reprobado una evaluacion (que no otorga puntos): en los dos casos
 * estuvo activo, y un reporte que dijera lo contrario mandaria a RH a
 * perseguir a alguien que si esta trabajando.
 */
async function obtenerUltimaActividad(userIds) {
    const resultado = new Map();
    if (userIds.length === 0) return resultado;

    const { rows } = await db.query(
        `SELECT user_id, MAX(momento) AS ultima FROM (
             SELECT user_id, created_at   AS momento FROM points_ledger   WHERE user_id = ANY($1::int[])
             UNION ALL
             SELECT user_id, created_at   AS momento FROM quiz_attempts   WHERE user_id = ANY($1::int[])
             UNION ALL
             SELECT user_id, completed_at AS momento FROM lesson_progress WHERE user_id = ANY($1::int[])
         ) actividad
         GROUP BY user_id`,
        [userIds]
    );

    for (const r of rows) resultado.set(r.user_id, r.ultima);
    return resultado;
}

// ---------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------

/**
 * Filas del reporte para una pagina de usuarios.
 *
 * @param {object} filtros     ya validados por validarFiltros()
 * @param {object} paginacion  { page, pageSize }
 */
async function obtenerFilas(filtros, { page, pageSize }) {
    const { where, params } = construirFiltroUsuarios(filtros);
    const offset = (page - 1) * pageSize;

    // Orden estable: sin el desempate por id, dos usuarios con los mismos
    // puntos podrian intercambiarse entre paginas y aparecer repetidos o
    // desaparecer al pasar de la 1 a la 2.
    const { rows: usuarios } = await db.query(
        `SELECT u.id, u.email, u.role, u.team_id, t.name AS equipo, u.created_at
           FROM users u
           LEFT JOIN teams t ON t.id = u.team_id
          WHERE ${where}
          ORDER BY u.total_points DESC, u.id ASC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset]
    );

    if (usuarios.length === 0) return [];

    const ids = usuarios.map(u => u.id);
    const rango = { from: filtros.from, to: filtros.to };

    // Cuatro consultas para toda la pagina, no cuatro por usuario.
    // La escalera se pide una sola vez y se aplica en memoria.
    const [puntosPorUsuario, insigniasPorUsuario, actividadPorUsuario, escalera] = await Promise.all([
        pointsService.obtenerTotalesPorUsuarios(ids, rango),
        rewardsService.obtenerResumenPorUsuarios(ids, rango),
        obtenerUltimaActividad(ids),
        levelsService.obtenerEscalera()
    ]);

    return usuarios.map(u => {
        const puntos = puntosPorUsuario.get(u.id) || { total: 0, movimientos: 0, ultimo: null };
        const insignias = insigniasPorUsuario.get(u.id) || { total: 0, nombres: [], ultima: null };

        // El nivel se calcula con la funcion del servicio de niveles, no con
        // una copia de la formula (criterio tecnico 3).
        //
        // Ojo con el rango de fechas: si RH filtra por un mes, `puntos.total`
        // es el de ese mes y el nivel resultante es "el nivel que darian esos
        // puntos", no el nivel real del usuario. Por eso se devuelven los dos:
        // nivel (segun el filtro) y nivel_actual (historico completo).
        const nivelFiltrado = levelsService.calcularProgreso(puntos.total, escalera);

        return {
            user_id: u.id,
            email: u.email,
            rol: u.role,
            team_id: u.team_id,
            equipo: u.equipo || 'Sin equipo',
            puntos: puntos.total,
            movimientos: puntos.movimientos,
            nivel: nivelFiltrado.nivel_actual,
            nivel_nombre: nivelFiltrado.nombre,
            porcentaje_avance: nivelFiltrado.porcentaje_avance,
            insignias: insignias.total,
            insignias_nombres: insignias.nombres,
            ultima_actividad: actividadPorUsuario.get(u.id) || null
        };
    });
}

/**
 * Agregados por equipo y por curso (criterio de aceptacion 1: "debo poder ver
 * esta informacion agregada por equipo o por curso").
 *
 * Se calculan sobre TODOS los usuarios que cumplen el filtro, no solo sobre la
 * pagina visible: un total que cambiara al pasar de pagina no seria un total.
 */
async function obtenerAgregados(filtros) {
    const { where, params } = construirFiltroUsuarios(filtros);
    const idxFrom = params.length + 1;
    const idxTo = params.length + 2;

    // Los puntos se suman desde points_ledger y no desde users.total_points
    // porque esa columna es una cache del historial COMPLETO: con un filtro de
    // fechas mentiria. Es la misma fuente que usa points.service.
    const sumaPuntos = `
        COALESCE(SUM(pl.points), 0)::int`;

    const joinLedger = `
        LEFT JOIN points_ledger pl
               ON pl.user_id = u.id
              AND ($${idxFrom}::timestamptz IS NULL OR pl.created_at >= $${idxFrom}::timestamptz)
              AND ($${idxTo}::timestamptz IS NULL OR pl.created_at < ($${idxTo}::timestamptz + interval '1 day'))`;

    const [porEquipo, porCurso] = await Promise.all([
        db.query(
            `SELECT COALESCE(t.name, 'Sin equipo') AS equipo,
                    t.id                            AS team_id,
                    COUNT(DISTINCT u.id)::int       AS usuarios,
                    ${sumaPuntos}                   AS puntos,
                    ROUND(COALESCE(SUM(pl.points), 0)::numeric
                          / NULLIF(COUNT(DISTINCT u.id), 0), 1)::float AS promedio_puntos
               FROM users u
               LEFT JOIN teams t ON t.id = u.team_id
               ${joinLedger}
              WHERE ${where}
              GROUP BY t.id, t.name
              ORDER BY puntos DESC`,
            [...params, filtros.from, filtros.to]
        ),
        db.query(
            `SELECT c.id AS course_id, c.title AS curso,
                    COUNT(DISTINCT u.id)::int AS usuarios,
                    COUNT(DISTINCT CASE WHEN ca.status = 'completed' THEN u.id END)::int AS completados
               FROM users u
               JOIN course_assignments ca ON ca.user_id = u.id
               JOIN courses c ON c.id = ca.course_id
              WHERE ${where}
              GROUP BY c.id, c.title
              ORDER BY usuarios DESC, c.title`,
            params
        )
    ]);

    return {
        por_equipo: porEquipo.rows,
        por_curso: porCurso.rows.map(r => ({
            ...r,
            porcentaje_completado: r.usuarios > 0
                ? Math.round(r.completados * 100 / r.usuarios)
                : 0
        }))
    };
}

/**
 * Reporte completo: filas paginadas + agregados + metadatos de paginacion.
 *
 * @param {object} filtros     ya validados
 * @param {object} paginacion  { page, pageSize }
 */
async function obtenerReporteDesempeno(filtros, paginacion) {
    const total = await contarUsuarios(filtros);
    const { page, pageSize } = paginacion;

    // Criterio de aceptacion 2: si no hay datos, estado vacio claro y no un
    // error. Se responde 200 con la lista vacia y los metadatos en cero.
    const filas = total === 0 ? [] : await obtenerFilas(filtros, paginacion);
    const agregados = total === 0
        ? { por_equipo: [], por_curso: [] }
        : await obtenerAgregados(filtros);

    return {
        filtros: {
            from: filtros.from,
            to: filtros.to,
            team_id: filtros.teamId,
            course_id: filtros.courseId
        },
        paginacion: {
            page,
            page_size: pageSize,
            total,
            total_paginas: Math.max(1, Math.ceil(total / pageSize))
        },
        vacio: total === 0,
        resultados: filas,
        agregados
    };
}

/**
 * Todas las filas que cumplen el filtro, sin paginar. Solo para exportar.
 *
 * La exportacion tiene que reflejar exactamente los filtros de la pantalla
 * (criterio de aceptacion 3), pero NO su paginacion: quien exporta espera el
 * reporte entero, no los 50 que tenia a la vista.
 */
async function obtenerTodasLasFilas(filtros) {
    const total = await contarUsuarios(filtros);
    if (total === 0) return [];
    return obtenerFilas(filtros, { page: 1, pageSize: total });
}

/** Opciones para el panel de filtros: equipos y cursos existentes. */
async function obtenerOpcionesDeFiltro() {
    const [equipos, cursos] = await Promise.all([
        db.query(`SELECT id, name FROM teams WHERE is_active = true ORDER BY name`),
        db.query(`SELECT id, title FROM courses ORDER BY title`)
    ]);
    return { equipos: equipos.rows, cursos: cursos.rows };
}

module.exports = {
    PAGE_SIZE_POR_DEFECTO,
    esFechaISO,
    validarFiltros,
    normalizarPaginacion,
    contarUsuarios,
    obtenerReporteDesempeno,
    obtenerTodasLasFilas,
    obtenerOpcionesDeFiltro
};
