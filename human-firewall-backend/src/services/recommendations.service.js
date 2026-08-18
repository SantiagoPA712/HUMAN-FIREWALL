/**
 * Motor de recomendaciones y resumen de desempeno.
 *
 * HU: "quiero recibir recomendaciones sobre como mejorar mi desempeno,
 * basadas en mi historial de evaluaciones y progreso".
 *
 * Criterio de aceptacion 3 y criterio tecnico 3: todo se calcula UNICAMENTE
 * con el historial del propio usuario. No hay una sola consulta que agregue
 * datos de terceros: cada SELECT filtra por user_id, y no se compara contra
 * promedios de otros ni contra un ranking.
 *
 * Criterio tecnico 4: este modulo es de SOLO LECTURA. No hay INSERT, UPDATE
 * ni DELETE sobre quiz_attempts ni lesson_progress: el historial es la
 * entrada, nunca la salida.
 *
 * Criterio tecnico 2: el umbral y los limites salen de recommendation_rules,
 * no del codigo. Nada de machine learning en esta version.
 */

const db = require('../config/db');

const REGLA_POR_DEFECTO = {
    code: 'refuerzo_por_puntaje_bajo',
    score_threshold: 70,
    include_failed: true,
    max_suggestions: 5
};

/** Regla activa. Si la tabla esta vacia, se cae a los valores del enunciado. */
async function obtenerRegla() {
    const { rows } = await db.query(
        `SELECT code, description, score_threshold, include_failed, max_suggestions
           FROM recommendation_rules
          WHERE is_active = true
          ORDER BY code
          LIMIT 1`
    );
    return rows[0] || REGLA_POR_DEFECTO;
}

/**
 * Resultado consolidado por evaluacion: cuantas veces la intento, su mejor
 * puntaje y si llego a aprobarla alguna vez.
 *
 * quiz_ref guarda el id de una simulacion (numerico) o de un desafio (texto),
 * segun quiz_type. Los JOIN comparan contra `id::varchar` en lugar de castear
 * quiz_ref a entero: castear reventaria al toparse con un ref como 'phishing'.
 */
async function obtenerEvaluaciones(userId) {
    const { rows } = await db.query(
        `SELECT q.quiz_ref,
                q.quiz_type,
                MAX(q.course_id)                      AS course_id,
                COALESCE(c.title, cur.title)          AS curso,
                COALESCE(ch.name, s.title, q.quiz_ref) AS titulo,
                COUNT(*)::int                         AS intentos,
                MAX(q.score)::int                     AS mejor_puntaje,
                MIN(q.score)::int                     AS peor_puntaje,
                BOOL_OR(q.passed)                     AS aprobada,
                MAX(q.passing_score)::int             AS puntaje_minimo,
                MAX(q.created_at)                     AS ultimo_intento,

                -- El ultimo intento, no solo el mejor. Sin esto, alguien que
                -- aprobo una vez y despues fallo dos veces seguidas quedaba
                -- fuera de las areas de oportunidad: el sistema le decia
                -- "segui asi" justo cuando estaba desaprendiendo.
                (ARRAY_AGG(q.score  ORDER BY q.created_at DESC, q.id DESC))[1]::int
                                                      AS ultimo_puntaje,
                (ARRAY_AGG(q.passed ORDER BY q.created_at DESC, q.id DESC))[1]
                                                      AS ultimo_aprobado
           FROM quiz_attempts q
           LEFT JOIN challenges  ch ON q.quiz_type = 'challenge'  AND ch.id = q.quiz_ref
           LEFT JOIN simulations s  ON q.quiz_type = 'simulation' AND s.id::varchar = q.quiz_ref
           LEFT JOIN courses     c   ON c.id = q.course_id
           LEFT JOIN courses     cur ON cur.id = COALESCE(ch.course_id, s.course_id)
          WHERE q.user_id = $1
          GROUP BY q.quiz_ref, q.quiz_type, c.title, cur.title, ch.name, s.title
          ORDER BY MAX(q.score) ASC, MAX(q.created_at) DESC`,
        [userId]
    );
    return rows;
}

/**
 * Criterio de aceptacion 1: evaluaciones con menor puntaje y reprobadas.
 *
 * Una evaluacion es area de oportunidad en tres casos:
 *
 *   1. Nunca se aprobo.
 *   2. Su mejor puntaje sigue por debajo del umbral.
 *   3. El ULTIMO intento fallo o quedo bajo el umbral, aunque antes se haya
 *      aprobado. Este caso faltaba y era el mas grave: alguien que aprobo con
 *      100 y despues fallo dos veces seguidas no aparecia por ningun lado,
 *      porque solo se miraba el maximo historico. El sistema le respondia
 *      "ninguna evaluacion por debajo del 70%" justo cuando acababa de fallar.
 *
 * El mejor puntaje sigue contando para el caso 2: quien saco 45 y despues 90
 * ya domina el tema y no tiene sentido seguir marcandoselo.
 */
function filtrarAreasDeOportunidad(evaluaciones, regla) {
    return evaluaciones
        .map(e => {
            // Un intento suelto puede no traer los campos del ultimo intento
            // (por ejemplo si la evaluacion viene de otra consulta): en ese
            // caso se cae al mejor puntaje, que siempre esta.
            const ultimoPuntaje = e.ultimo_puntaje != null ? e.ultimo_puntaje : e.mejor_puntaje;
            const ultimoAprobado = e.ultimo_aprobado != null ? e.ultimo_aprobado : e.aprobada;

            const nuncaAprobada = !e.aprobada;
            const mejorBajoUmbral = e.mejor_puntaje < regla.score_threshold;
            const retrocedio = e.aprobada && (!ultimoAprobado || ultimoPuntaje < regla.score_threshold);

            const esArea = (nuncaAprobada && regla.include_failed) || mejorBajoUmbral || retrocedio;
            if (!esArea) return null;

            let motivo;
            if (nuncaAprobada) {
                motivo = `Todavía no aprobás esta evaluación (mejor intento: ${e.mejor_puntaje}%)`;
            } else if (retrocedio) {
                motivo = !ultimoAprobado
                    ? `La aprobaste antes, pero tu último intento falló (${ultimoPuntaje}%)`
                    : `Tu último intento bajó a ${ultimoPuntaje}%, por debajo del ${regla.score_threshold}% esperado`;
            } else {
                motivo = `Tu mejor puntaje fue ${e.mejor_puntaje}%, por debajo del ${regla.score_threshold}% esperado`;
            }

            return { ...e, ultimo_puntaje: ultimoPuntaje, retrocedio, motivo };
        })
        .filter(Boolean);
}

/**
 * Evaluaciones que el usuario todavia no intento ni una vez.
 *
 * Los desafios del portal (ChallengesHub) se le ofrecen a cualquier usuario
 * autenticado, sin asignacion previa, asi que se listan todos los que no haya
 * intentado. Antes se filtraban tambien por curso asignado, y eso dejo de
 * funcionar cuando la migracion 023 les puso course_id: un usuario recien
 * registrado, sin asignaciones, se quedaba sin ver ninguno.
 *
 * Las simulaciones si respetan la asignacion: son contenido de un curso
 * concreto, no del portal abierto (regla de negocio RN-01).
 */
async function obtenerPendientes(userId) {
    const { rows } = await db.query(
        `SELECT ch.id::varchar AS quiz_ref, 'challenge' AS quiz_type,
                ch.name AS titulo, ch.course_id, c.title AS curso,
                ch.points_reward AS puntos
           FROM challenges ch
           LEFT JOIN courses c ON c.id = ch.course_id
          WHERE NOT EXISTS (
                    SELECT 1 FROM quiz_attempts q
                     WHERE q.user_id = $1 AND q.quiz_type = 'challenge' AND q.quiz_ref = ch.id
                )

          UNION ALL

         SELECT s.id::varchar, 'simulation', s.title, s.course_id, c.title, NULL
           FROM simulations s
           LEFT JOIN courses c ON c.id = s.course_id
          WHERE NOT EXISTS (
                    SELECT 1 FROM quiz_attempts q
                     WHERE q.user_id = $1 AND q.quiz_type = 'simulation' AND q.quiz_ref = s.id::varchar
                )
            AND (s.course_id IS NULL OR s.course_id IN (
                    SELECT course_id FROM course_assignments WHERE user_id = $1
                ))
          ORDER BY titulo`,
        [userId]
    );
    return rows;
}

/**
 * Criterio de aceptacion 1: comparacion del progreso actual contra el propio
 * historial. Devuelve la serie cronologica para el grafico de evolucion y un
 * contraste entre los intentos recientes y los anteriores.
 *
 * La comparacion es SIEMPRE contra uno mismo: no se usa ningun dato de otros
 * usuarios (criterio de aceptacion 3).
 */
async function obtenerEvolucion(userId, ventana = 5) {
    const { rows: serie } = await db.query(
        `SELECT q.quiz_ref, q.quiz_type, q.score, q.passed, q.created_at,
                COALESCE(ch.name, s.title, q.quiz_ref) AS titulo
           FROM quiz_attempts q
           LEFT JOIN challenges  ch ON q.quiz_type = 'challenge'  AND ch.id = q.quiz_ref
           LEFT JOIN simulations s  ON q.quiz_type = 'simulation' AND s.id::varchar = q.quiz_ref
          WHERE q.user_id = $1
          ORDER BY q.created_at ASC, q.id ASC`,
        [userId]
    );

    const promedio = (lista) =>
        lista.length === 0 ? null : Math.round(lista.reduce((a, x) => a + x.score, 0) / lista.length);

    // La ventana no puede llevarse mas de la mitad de la serie. Con el valor
    // fijo de 5, un usuario con exactamente 5 intentos se quedaba sin nada en
    // "previos" y la pantalla le decia "todavia no hay suficientes intentos
    // para comparar" mostrandole cinco puntos en el grafico.
    const ventanaEfectiva = Math.max(1, Math.min(ventana, Math.floor(serie.length / 2)));

    const recientes = serie.slice(-ventanaEfectiva);
    const previos = serie.slice(0, -ventanaEfectiva);

    const promRecientes = promedio(recientes);
    const promPrevios = promedio(previos);

    // Sin intentos anteriores no hay con que comparar: decir "mejoraste" o
    // "empeoraste" con un solo dato seria inventar una tendencia.
    let tendencia = 'sin_datos';
    let diferencia = null;

    if (promPrevios !== null && promRecientes !== null) {
        diferencia = promRecientes - promPrevios;
        if (diferencia > 2) tendencia = 'mejorando';
        else if (diferencia < -2) tendencia = 'bajando';
        else tendencia = 'estable';
    }

    return {
        serie,
        total_intentos: serie.length,
        promedio_general: promedio(serie),
        promedio_reciente: promRecientes,
        promedio_previo: promPrevios,
        diferencia,
        tendencia,
        ventana: ventanaEfectiva
    };
}

/** Avance de lecciones por curso asignado. */
async function obtenerAvanceCursos(userId) {
    const { rows } = await db.query(
        `SELECT c.id AS course_id,
                c.title AS curso,
                ca.status,
                COUNT(cc.id)::int AS lecciones_totales,
                COUNT(lp.id)::int AS lecciones_completadas
           FROM course_assignments ca
           JOIN courses c ON c.id = ca.course_id
           LEFT JOIN course_contents cc ON cc.course_id = c.id
           LEFT JOIN lesson_progress lp ON lp.content_id = cc.id AND lp.user_id = $1
          WHERE ca.user_id = $1
          GROUP BY c.id, c.title, ca.status
          ORDER BY c.title`,
        [userId]
    );

    return rows.map(r => ({
        ...r,
        porcentaje: r.lecciones_totales > 0
            ? Math.round(r.lecciones_completadas * 100 / r.lecciones_totales)
            : 0
    }));
}

/**
 * Criterio de aceptacion 2: ante evaluaciones reprobadas o por debajo del
 * umbral, sugiere lecciones de refuerzo relacionadas con ese tema.
 *
 * "Relacionadas" = del mismo curso al que pertenecia la evaluacion. Ese enlace
 * existe gracias a quiz_attempts.course_id, que la migracion 003 agrego
 * justamente para esta historia.
 *
 * Solo se sugieren lecciones que el usuario todavia no completo: recomendarle
 * algo que ya hizo no lo ayuda a mejorar.
 */
async function generarRecomendaciones(userId, areas, regla) {
    const cursos = [...new Set(areas.map(a => a.course_id).filter(Boolean))];
    if (cursos.length === 0) return [];

    const { rows: lecciones } = await db.query(
        `SELECT cc.id AS content_id, cc.course_id, cc.content_type,
                cc.order_idx, cc.points_reward,
                c.title AS curso,
                LEFT(cc.body, 120) AS extracto
           FROM course_contents cc
           JOIN courses c ON c.id = cc.course_id
          WHERE cc.course_id = ANY($1::int[])
            AND NOT EXISTS (
                    SELECT 1 FROM lesson_progress lp
                     WHERE lp.user_id = $2 AND lp.content_id = cc.id
                )
          ORDER BY cc.course_id, cc.order_idx, cc.id`,
        [cursos, userId]
    );

    // Cada leccion se sugiere por el area mas floja de su curso, para que el
    // motivo que se muestra sea el mas relevante.
    //
    // Se compara por el ULTIMO puntaje, no por el mejor: en un retroceso
    // (aprobo con 100 y despues fallo) el mejor sigue siendo 100, y el motivo
    // terminaba diciendo "sugerido porque tu puntaje fue 100%", que ademas de
    // absurdo contradecia el area de oportunidad que estaba justo arriba.
    const puntajeRelevante = (a) => (a.ultimo_puntaje != null ? a.ultimo_puntaje : a.mejor_puntaje);

    const peorAreaPorCurso = new Map();
    for (const a of areas) {
        if (!a.course_id) continue;
        const previa = peorAreaPorCurso.get(a.course_id);
        if (!previa || puntajeRelevante(a) < puntajeRelevante(previa)) {
            peorAreaPorCurso.set(a.course_id, a);
        }
    }

    return lecciones.slice(0, regla.max_suggestions).map(l => {
        const area = peorAreaPorCurso.get(l.course_id);
        return {
            content_id: l.content_id,
            course_id: l.course_id,
            curso: l.curso,
            content_type: l.content_type,
            extracto: l.extracto,
            puntos: l.points_reward,
            motivo: area
                ? (area.retrocedio
                    ? `Sugerido porque tu último intento en "${area.titulo}" bajó a ${puntajeRelevante(area)}%`
                    : `Sugerido porque tu puntaje en "${area.titulo}" fue ${puntajeRelevante(area)}%`)
                : 'Leccion de refuerzo pendiente'
        };
    });
}

/**
 * Resumen completo para la pantalla "Mi desempeno".
 * Es la unica funcion que consume el controlador.
 */
async function obtenerResumenDesempeno(userId) {
    const regla = await obtenerRegla();

    const [evaluaciones, pendientes, evolucion, cursos] = await Promise.all([
        obtenerEvaluaciones(userId),
        obtenerPendientes(userId),
        obtenerEvolucion(userId),
        obtenerAvanceCursos(userId)
    ]);

    const areas = filtrarAreasDeOportunidad(evaluaciones, regla);
    const recomendaciones = await generarRecomendaciones(userId, areas, regla);

    return {
        user_id: userId,
        regla: {
            code: regla.code,
            umbral: regla.score_threshold,
            incluye_reprobadas: regla.include_failed
        },
        resumen: {
            evaluaciones_realizadas: evaluaciones.length,
            aprobadas: evaluaciones.filter(e => e.aprobada).length,
            reprobadas: evaluaciones.filter(e => !e.aprobada).length,
            areas_de_oportunidad: areas.length,
            pendientes: pendientes.length,
            promedio_general: evolucion.promedio_general
        },
        areas_de_oportunidad: areas,
        pendientes,
        evolucion,
        cursos,
        recomendaciones
    };
}

module.exports = {
    REGLA_POR_DEFECTO,
    obtenerRegla,
    obtenerEvaluaciones,
    filtrarAreasDeOportunidad,
    obtenerPendientes,
    obtenerEvolucion,
    obtenerAvanceCursos,
    generarRecomendaciones,
    obtenerResumenDesempeno
};
