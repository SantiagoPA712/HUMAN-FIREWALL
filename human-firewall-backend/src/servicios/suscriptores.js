/**
 * Cableado del bus de eventos.
 *
 * Un solo lugar donde se conectan todos los servicios al bus. Cada servicio
 * es dueno de SUS suscripciones (su index.js dice a que eventos se engancha
 * y con que funcion); este archivo solo los recorre.
 *
 * El orden NO importa: los handlers de un mismo evento corren todos, y
 * ninguno depende de que otro haya corrido antes.
 */

const eventBus = require('../compartido/eventos/eventBus');
const { SERVICIOS } = require('./index');

/**
 * Registra todos los suscriptores y arranca el worker y los procesos de
 * fondo de cada servicio.
 *
 * @param {object}  [opciones]
 * @param {boolean} [opciones.iniciarWorker=true]  Las pruebas lo desactivan y
 *        drenan la cola a mano, para no depender de un temporizador.
 */
function conectarTodo({ iniciarWorker = true } = {}) {
    for (const servicio of SERVICIOS) servicio.registrarHandlers();

    // Cada servicio publica en la cola de su propia base: el worker las lee todas.
    eventBus.usarBases(SERVICIOS.map(s => s.baseDeDatos()));

    if (iniciarWorker) {
        eventBus.iniciarWorker();
        // Relojes y workers propios de cada servicio (scheduler de reportes,
        // job de KPIs, deteccion de anomalias, retencion de logs, cola de
        // correo, fechas limite de cursos). No son suscripciones: las pruebas
        // registran handlers sin querer que arranque nada de fondo.
        for (const servicio of SERVICIOS) servicio.iniciarProcesos();
    }

    const suscritos = eventBus.eventosSuscritos();
    const total = Object.values(suscritos).reduce((a, b) => a + b, 0);
    console.log(
        `[eventos] ${Object.keys(suscritos).length} eventos con suscriptor, ` +
        `${total} handlers en total`
    );

    return suscritos;
}

module.exports = { conectarTodo, SERVICIOS };
