/**
 * Servicio de niveles.
 *
 * HU: "quiero ver mi nivel actual, calculado a partir de mis puntos
 * acumulados, y cuanto me falta para el siguiente".
 *
 * Criterio tecnico 3: el nivel es DERIVADO. Se calcula cada vez contra
 * points_ledger (via la vista v_user_points) y la tabla levels_config.
 * users.level se mantiene solo como cache para el ranking y el dashboard, y
 * se recalcula ante cada asignacion de puntos; nunca se lee como fuente de
 * verdad. Asi, si manana cambian los umbrales, el nivel que ve el usuario
 * cambia solo, sin migrar datos.
 */

const db = require('../config/db');
const eventBus = require('./eventBus');

/**
 * Escalera de niveles activos, de menor a mayor umbral.
 * @returns {Promise<Array<{level:number,name:string,min_points:number}>>}
 */
async function obtenerEscalera() {
    const { rows } = await db.query(
        `SELECT level, name, description, icon_url, min_points
           FROM levels_config
          WHERE is_active = true
          ORDER BY min_points ASC, level ASC`
    );
    return rows;
}

/** Total acumulado del usuario, leido del historial y no de la cache. */
async function obtenerPuntos(userId) {
    const { rows } = await db.query(
        `SELECT COALESCE(total_points, 0) AS total FROM v_user_points WHERE user_id = $1`,
        [userId]
    );
    // Un usuario sin ningun movimiento no aparece en la vista: tiene 0 puntos.
    return Number(rows[0]?.total || 0);
}

/**
 * Calcula el nivel y el avance dentro de el. Funcion pura: no toca la base,
 * asi que se puede probar con cualquier escalera sin montar datos.
 *
 * El nivel es el mayor cuyo min_points no supera los puntos del usuario.
 *
 * @param {number} puntos
 * @param {Array}  escalera  ordenada por min_points ascendente
 */
function calcularProgreso(puntos, escalera) {
    if (!escalera || escalera.length === 0) {
        return {
            nivel_actual: null, nombre: null, puntos_actuales: puntos,
            porcentaje_avance: 0, es_nivel_maximo: true,
            siguiente_nivel: null, puntos_para_siguiente: null, puntos_faltantes: null
        };
    }

    let indice = 0;
    for (let i = 0; i < escalera.length; i++) {
        if (puntos >= escalera[i].min_points) indice = i;
        else break;
    }

    const actual = escalera[indice];
    const siguiente = escalera[indice + 1] || null;

    // En el ultimo nivel no hay "siguiente umbral": el avance es 100% y lo
    // que falta es 0. Devolver null en puntos_para_siguiente evita que el
    // frontend pinte una barra contra un objetivo inexistente.
    if (!siguiente) {
        return {
            nivel_actual: actual.level,
            nombre: actual.name,
            descripcion: actual.description,
            icon_url: actual.icon_url,
            nivel_min_puntos: actual.min_points,
            puntos_actuales: puntos,
            siguiente_nivel: null,
            siguiente_nombre: null,
            puntos_para_siguiente: null,
            puntos_faltantes: 0,
            porcentaje_avance: 100,
            es_nivel_maximo: true
        };
    }

    const rango = siguiente.min_points - actual.min_points;
    const avance = puntos - actual.min_points;

    return {
        nivel_actual: actual.level,
        nombre: actual.name,
        descripcion: actual.description,
        icon_url: actual.icon_url,
        nivel_min_puntos: actual.min_points,
        puntos_actuales: puntos,
        siguiente_nivel: siguiente.level,
        siguiente_nombre: siguiente.name,
        puntos_para_siguiente: siguiente.min_points,
        puntos_faltantes: Math.max(0, siguiente.min_points - puntos),
        // rango > 0 siempre, porque min_points es UNIQUE y esta ordenado.
        porcentaje_avance: Math.max(0, Math.min(100, Math.round(avance * 100 / rango))),
        es_nivel_maximo: false
    };
}

/** Niveles que el usuario ya alcanzo, del mas reciente al mas antiguo. */
async function obtenerHistorialNiveles(userId) {
    const { rows } = await db.query(
        `SELECT level, level_name, min_points, points_at, reached_at
           FROM user_level_history
          WHERE user_id = $1
          ORDER BY level DESC`,
        [userId]
    );
    return rows;
}

/**
 * Criterio de aceptacion 1: nivel actual, puntos acumulados, puntos
 * requeridos para el siguiente y porcentaje de avance dentro del nivel.
 */
async function obtenerNivelDeUsuario(userId) {
    const [puntos, escalera, historial] = await Promise.all([
        obtenerPuntos(userId),
        obtenerEscalera(),
        obtenerHistorialNiveles(userId)
    ]);

    return {
        user_id: userId,
        ...calcularProgreso(puntos, escalera),
        historial
    };
}

/**
 * Criterio de aceptacion 2: recalcula el nivel tras ganar puntos y, si el
 * usuario cruzo uno o mas umbrales, lo deja registrado y avisa.
 *
 * Un solo movimiento grande puede saltar varios niveles a la vez, asi que se
 * registran todos los intermedios: el historial debe poder responder "cuando
 * llegaste al nivel 3" aunque hayas pasado del 2 al 4 de un tiron.
 *
 * @returns {Promise<{nivel:number, subio:boolean, niveles_nuevos:number[]}>}
 */
async function sincronizarNivel({ userId }) {
    if (!userId) return { nivel: null, subio: false, niveles_nuevos: [] };

    const puntos = await obtenerPuntos(userId);
    const escalera = await obtenerEscalera();
    const progreso = calcularProgreso(puntos, escalera);

    if (progreso.nivel_actual == null) {
        return { nivel: null, subio: false, niveles_nuevos: [] };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Todos los niveles que le corresponden y todavia no estan registrados.
        const alcanzados = escalera.filter(n => n.level <= progreso.nivel_actual);
        const nuevos = [];

        for (const nivel of alcanzados) {
            const { rows } = await client.query(
                `INSERT INTO user_level_history (user_id, level, level_name, min_points, points_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (user_id, level) DO NOTHING
                 RETURNING level`,
                [userId, nivel.level, nivel.name, nivel.min_points, puntos]
            );
            if (rows.length > 0) nuevos.push(nivel.level);
        }

        // Cache. Se escribe el valor calculado, no un incremento, por el mismo
        // motivo que total_points: un incremento se puede desincronizar.
        await client.query(
            `UPDATE users SET level = $1 WHERE id = $2 AND level IS DISTINCT FROM $1`,
            [progreso.nivel_actual, userId]
        );

        // El nivel 1 no se anuncia: todos arrancan ahi, no es un logro.
        const subidasReales = nuevos.filter(n => n > (escalera[0]?.level ?? 1));

        if (subidasReales.length > 0) {
            await eventBus.publish('level_up', {
                userId,
                nivel: progreso.nivel_actual,
                nombre: progreso.nombre,
                nivelesAlcanzados: subidasReales,
                puntos
            }, client);
        }

        await client.query('COMMIT');
        return { nivel: progreso.nivel_actual, subio: subidasReales.length > 0, niveles_nuevos: subidasReales };

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Conecta el servicio al bus. Se llama una sola vez desde server.js.
 *
 * Se engancha a points_assigned, que es el evento que emite points.service
 * cada vez que el ledger crece. No hace falta tocar points.service para esto:
 * es el contrato que documenta el README.
 */
function registrarHandlers() {
    eventBus.subscribe('points_assigned', ({ userId }) => sincronizarNivel({ userId }));
    console.log('[levels.service] handlers registrados');
}

module.exports = {
    obtenerEscalera,
    obtenerPuntos,
    calcularProgreso,
    obtenerHistorialNiveles,
    obtenerNivelDeUsuario,
    sincronizarNivel,
    registrarHandlers
};
