/**
 * Motor de evaluacion de recompensas.
 *
 * Criterio tecnico 2: se ejecuta de forma asincrona tras los eventos
 * relevantes (points_assigned, course.completed, quiz.approved), igual que el
 * servicio de puntos.
 *
 * Ante cada evento se revisan todas las recompensas activas del catalogo y se
 * otorgan las que el usuario ya cumple. Las condiciones se leen de
 * rewards_catalog, no estan hardcodeadas.
 */

const db = require('../config/db');
const eventBus = require('./eventBus');

/**
 * Calculadores de condicion. Cada uno devuelve el progreso actual del usuario
 * en la unidad que mide esa condicion.
 *
 * Agregar un tipo nuevo es agregar una entrada aca y un valor mas al CHECK de
 * la migracion 006.
 */
const CALCULADORES = {
    async points_total(userId) {
        const { rows } = await db.query(
            `SELECT COALESCE(total_points, 0) AS valor FROM v_user_points WHERE user_id = $1`,
            [userId]
        );
        return rows[0]?.valor || 0;
    },

    async lessons_completed(userId) {
        const { rows } = await db.query(
            `SELECT COUNT(*)::int AS valor FROM lesson_progress WHERE user_id = $1`,
            [userId]
        );
        return rows[0].valor;
    },

    async courses_completed(userId) {
        const { rows } = await db.query(
            `SELECT COUNT(*)::int AS valor
               FROM course_assignments
              WHERE user_id = $1 AND status = 'completed'`,
            [userId]
        );
        return rows[0].valor;
    },

    async quizzes_approved(userId) {
        const { rows } = await db.query(
            `SELECT COUNT(DISTINCT quiz_ref)::int AS valor
               FROM quiz_attempts
              WHERE user_id = $1 AND passed = true`,
            [userId]
        );
        return rows[0].valor;
    },

    /**
     * Racha: cuantas evaluaciones seguidas aprobo, contando desde la mas
     * reciente hacia atras. Un intento reprobado corta la racha.
     */
    async quiz_streak(userId) {
        const { rows } = await db.query(
            `SELECT passed FROM quiz_attempts
              WHERE user_id = $1
              ORDER BY created_at DESC, id DESC
              LIMIT 100`,
            [userId]
        );

        let racha = 0;
        for (const intento of rows) {
            if (!intento.passed) break;
            racha++;
        }
        return racha;
    }
};

/** Recompensas activas del catalogo. */
async function obtenerCatalogoActivo() {
    const { rows } = await db.query(
        `SELECT id, name, description, icon_url, condition_type, condition_params, is_repeatable
           FROM rewards_catalog
          WHERE is_active = true
          ORDER BY id`
    );
    return rows;
}

/** Umbral configurado para una recompensa. */
function umbralDe(recompensa) {
    const params = recompensa.condition_params || {};
    const valor = Number(params.threshold);
    return Number.isFinite(valor) ? valor : Infinity;
}

/**
 * Otorga una recompensa guardando un snapshot de como estaba en el catalogo.
 *
 * Criterio tecnico 3: si mas adelante la recompensa se edita o se elimina, el
 * registro del usuario conserva el nombre, la descripcion y el icono que
 * tenia al momento de otorgarse.
 *
 * @returns {Promise<object|null>} la recompensa otorgada, o null si ya la tenia
 */
async function otorgarRecompensa({ recompensa, userId, sourceType, sourceId, valorAlcanzado }) {
    // Criterio de aceptacion 2: una recompensa no repetible se otorga una sola
    // vez; una repetible, una vez por logro que la dispara.
    const dedupeKey = recompensa.is_repeatable
        ? `reward:${recompensa.id}:${userId}:${sourceType}:${sourceId ?? 'x'}`
        : `reward:${recompensa.id}:${userId}`;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `INSERT INTO user_rewards
                (user_id, reward_id, reward_name, reward_description, reward_icon_url,
                 source_type, source_id, condition_snapshot, dedupe_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (dedupe_key) DO NOTHING
             RETURNING id, reward_id, reward_name, reward_description, reward_icon_url, earned_at`,
            [
                userId,
                recompensa.id,
                recompensa.name,
                recompensa.description,
                recompensa.icon_url,
                sourceType,
                sourceId != null ? String(sourceId) : null,
                JSON.stringify({
                    condition_type: recompensa.condition_type,
                    threshold: umbralDe(recompensa),
                    valor_alcanzado: valorAlcanzado
                }),
                dedupeKey
            ]
        );

        if (rows.length === 0) {
            await client.query('COMMIT');
            return null;   // ya la tenia
        }

        const otorgada = rows[0];

        // Evento para el frontend y para cualquier historia que quiera
        // reaccionar a un logro nuevo.
        await eventBus.publish('reward_granted', {
            userId,
            rewardId: recompensa.id,
            rewardName: recompensa.name,
            userRewardId: otorgada.id
        }, client);

        await client.query('COMMIT');
        return otorgada;

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Criterio de aceptacion 1: ante una accion relevante, verifica las
 * condiciones de todas las recompensas activas y otorga las que correspondan.
 *
 * @returns {Promise<object[]>} las recompensas efectivamente otorgadas
 */
async function evaluarRecompensas({ userId, sourceType = 'system', sourceId = null }) {
    if (!userId) return [];

    const catalogo = await obtenerCatalogoActivo();
    const otorgadas = [];

    // Se calcula una sola vez por tipo de condicion, aunque varias recompensas
    // compartan el mismo tipo.
    const cache = new Map();

    for (const recompensa of catalogo) {
        const calculador = CALCULADORES[recompensa.condition_type];
        if (!calculador) {
            console.warn(`[rewards] tipo de condicion desconocido: ${recompensa.condition_type}`);
            continue;
        }

        if (!cache.has(recompensa.condition_type)) {
            cache.set(recompensa.condition_type, await calculador(userId));
        }
        const valorActual = cache.get(recompensa.condition_type);

        if (valorActual < umbralDe(recompensa)) continue;

        const resultado = await otorgarRecompensa({
            recompensa,
            userId,
            sourceType,
            sourceId,
            valorAlcanzado: valorActual
        });

        if (resultado) otorgadas.push(resultado);
    }

    return otorgadas;
}

/**
 * Recompensas de un usuario: las obtenidas y las que aun no.
 * Las bloqueadas incluyen la condicion y el progreso actual, para poder
 * mostrarlas en gris con el texto de que falta para desbloquearlas.
 */
async function obtenerRecompensasDeUsuario(userId) {
    const { rows: obtenidas } = await db.query(
        `SELECT id, reward_id, reward_name, reward_description, reward_icon_url,
                source_type, source_id, condition_snapshot, earned_at
           FROM user_rewards
          WHERE user_id = $1
          ORDER BY earned_at DESC`,
        [userId]
    );

    const catalogo = await obtenerCatalogoActivo();
    const idsObtenidos = new Set(obtenidas.map(o => o.reward_id).filter(Boolean));

    const cache = new Map();
    const bloqueadas = [];

    for (const recompensa of catalogo) {
        if (idsObtenidos.has(recompensa.id) && !recompensa.is_repeatable) continue;

        const calculador = CALCULADORES[recompensa.condition_type];
        if (!calculador) continue;

        if (!cache.has(recompensa.condition_type)) {
            cache.set(recompensa.condition_type, await calculador(userId));
        }
        const progreso = cache.get(recompensa.condition_type);
        const umbral = umbralDe(recompensa);

        if (progreso >= umbral && idsObtenidos.has(recompensa.id)) continue;

        bloqueadas.push({
            reward_id: recompensa.id,
            name: recompensa.name,
            description: recompensa.description,
            icon_url: recompensa.icon_url,
            condition_type: recompensa.condition_type,
            threshold: umbral,
            progreso,
            porcentaje: umbral > 0 ? Math.min(100, Math.round(progreso * 100 / umbral)) : 0
        });
    }

    return {
        user_id: userId,
        total_obtenidas: obtenidas.length,
        obtenidas,
        bloqueadas
    };
}

/** Conecta el servicio al bus. Se llama una vez al arrancar el servidor. */
function registrarHandlers() {
    eventBus.subscribe('points_assigned', ({ userId, sourceType, sourceId }) =>
        evaluarRecompensas({ userId, sourceType: sourceType || 'points_assigned', sourceId })
    );

    eventBus.subscribe('course.completed', ({ userId, courseId }) =>
        evaluarRecompensas({ userId, sourceType: 'course', sourceId: courseId })
    );

    eventBus.subscribe('quiz.approved', ({ userId, quizRef, passed }) => {
        if (!passed) return Promise.resolve([]);
        return evaluarRecompensas({ userId, sourceType: 'quiz', sourceId: quizRef });
    });

    console.log('[rewards.service] handlers registrados');
}

module.exports = {
    CALCULADORES,
    obtenerCatalogoActivo,
    otorgarRecompensa,
    evaluarRecompensas,
    obtenerRecompensasDeUsuario,
    registrarHandlers
};
