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

const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { conTransaccion } = require('../../../compartido/config/transaccion');
const { calcularProgreso } = require('../domain/nivel');
const repo = require('../infrastructure/persistence/niveles.repositorio');

/** Escalera de niveles activos, de menor a mayor umbral. */
const obtenerEscalera = () => repo.escalera();

/** Total acumulado del usuario, leido del historial y no de la cache. */
const obtenerPuntos = (userId) => repo.puntosDe(userId);

/** Niveles que el usuario ya alcanzo, del mas reciente al mas antiguo. */
const obtenerHistorialNiveles = (userId) => repo.historialDe(userId);

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

    return conTransaccion(async (tx) => {
        // Todos los niveles que le corresponden y todavia no estan registrados.
        const alcanzados = escalera.filter(n => n.level <= progreso.nivel_actual);
        const nuevos = [];

        for (const nivel of alcanzados) {
            if (await repo.registrarNivelAlcanzado({ userId, nivel, puntos }, tx)) nuevos.push(nivel.level);
        }

        await repo.guardarNivelEnCache(userId, progreso.nivel_actual, tx);

        // El nivel 1 no se anuncia: todos arrancan ahi, no es un logro.
        const subidasReales = nuevos.filter(n => n > (escalera[0]?.level ?? 1));

        if (subidasReales.length > 0) {
            await eventBus.publish(EVENTOS.LEVEL_UP, {
                userId,
                nivel: progreso.nivel_actual,
                nombre: progreso.nombre,
                nivelesAlcanzados: subidasReales,
                puntos
            }, tx);
        }

        return { nivel: progreso.nivel_actual, subio: subidasReales.length > 0, niveles_nuevos: subidasReales };
    });
}

/**
 * Conecta el servicio al bus. Se llama una sola vez desde server.js.
 *
 * Se engancha a points_assigned, que es el evento que emite points.service
 * cada vez que el ledger crece. No hace falta tocar points.service para esto:
 * es el contrato que documenta el README.
 */
function registrarHandlers() {
    eventBus.subscribe(EVENTOS.POINTS_ASSIGNED, ({ userId }) => sincronizarNivel({ userId }));
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
