/**
 * Cableado del bus de eventos.
 *
 * Un solo lugar donde se ve, de un vistazo, quien escucha que. Antes esto
 * estaba desperdigado en server.js entre los requires del arranque, y agregar
 * un servicio nuevo obligaba a acordarse de registrarlo ahi en medio.
 *
 * Cada servicio sigue siendo dueno de SUS suscripciones (su propio
 * registrarHandlers dice a que eventos se engancha y con que funcion). Este
 * archivo solo decide QUE servicios participan. Esa division importa: si el
 * cableado concreto viviera aca, este archivo tendria que conocer las
 * funciones internas de los cinco servicios y volveriamos al acoplamiento que
 * la arquitectura de eventos vino a quitar.
 *
 * El orden NO importa: los handlers de un mismo evento corren todos, y
 * ninguno depende de que otro haya corrido antes. Si alguna vez importara,
 * seria senal de que esos dos handlers son en realidad un solo paso y
 * deberian vivir juntos.
 */

const eventBus = require('../services/eventBus');
const pointsService = require('../services/points.service');
const rewardsService = require('../services/rewards.service');
const levelsService = require('../services/levels.service');
const notificationsService = require('../services/notifications.service');
const recommendationsService = require('../services/recommendations.service');

const SERVICIOS = [
    pointsService,          // lesson/quiz/course/simulation.decision -> puntos
    rewardsService,         // puntos/curso/quiz/simulacion           -> recompensas
    levelsService,          // puntos                                 -> nivel
    recommendationsService, // quiz/simulacion                        -> refuerzos
    notificationsService    // registro/nivel/recompensa              -> avisos
];

/**
 * Registra todos los suscriptores y arranca el worker.
 *
 * @param {object}  [opciones]
 * @param {boolean} [opciones.iniciarWorker=true]  Las pruebas lo desactivan y
 *        drenan la cola a mano, para no depender de un temporizador.
 */
function conectarTodo({ iniciarWorker = true } = {}) {
    for (const servicio of SERVICIOS) servicio.registrarHandlers();

    if (iniciarWorker) eventBus.iniciarWorker();

    const suscritos = eventBus.eventosSuscritos();
    const total = Object.values(suscritos).reduce((a, b) => a + b, 0);
    console.log(
        `[eventos] ${Object.keys(suscritos).length} eventos con suscriptor, ` +
        `${total} handlers en total`
    );

    return suscritos;
}

module.exports = { conectarTodo, SERVICIOS };
