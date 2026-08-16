/**
 * Bus de eventos con patron outbox.
 *
 * Criterio tecnico 1 de la HU de puntos: el servicio de gamificacion debe
 * consumir los eventos de forma asincrona, sin bloquear la respuesta de la
 * accion original.
 *
 * Como funciona:
 *   1. publish() solo INSERTA la fila en event_outbox y retorna. Es una
 *      escritura, no ejecuta ninguna regla de negocio, asi que el endpoint
 *      original responde de inmediato.
 *   2. Un worker toma los pendientes y ejecuta los handlers por fuera del
 *      ciclo de request/response.
 *   3. Si el proceso se cae a mitad de camino, el evento sigue en estado
 *      'pending' y se reintenta cuando el servidor vuelve a arrancar. Con un
 *      EventEmitter puro en memoria ese evento se perderia.
 */

const db = require('../config/db');

const MAX_INTENTOS = 5;
const INTERVALO_WORKER_MS = 5000;

// eventName -> [handler]
const handlers = new Map();
let workerTimer = null;
let procesando = false;

/**
 * Registra un handler para un evento.
 * @param {string} eventName  ej. 'lesson.completed'
 * @param {(payload: object) => Promise<void>} handler
 */
function subscribe(eventName, handler) {
    if (!handlers.has(eventName)) handlers.set(eventName, []);
    handlers.get(eventName).push(handler);
}

/**
 * Publica un evento. No ejecuta los handlers: solo lo deja encolado.
 *
 * @param {string} eventName
 * @param {object} payload
 * @param {object} [client]  Si se pasa un cliente de una transaccion en curso,
 *                           el evento se encola dentro de esa misma transaccion.
 *                           Asi el evento existe si y solo si la accion original
 *                           se confirmo.
 * @returns {Promise<number>} id del evento encolado
 */
async function publish(eventName, payload, client = db) {
    const { rows } = await client.query(
        `INSERT INTO event_outbox (event_name, payload) VALUES ($1, $2) RETURNING id`,
        [eventName, JSON.stringify(payload)]
    );

    // Despierta al worker sin esperarlo: la respuesta HTTP no depende de esto.
    setImmediate(() => {
        procesarPendientes().catch(err =>
            console.error('[eventBus] error procesando pendientes:', err.message)
        );
    });

    return rows[0].id;
}

/**
 * Toma un evento pendiente y lo procesa.
 *
 * Usa FOR UPDATE SKIP LOCKED para que, si algun dia corren varias instancias
 * del servidor, dos workers no tomen el mismo evento.
 *
 * @returns {Promise<boolean>} true si proceso alguno, false si no habia nada
 */
async function procesarUno() {
    const client = await db.connect();
    let evento;

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id, event_name, payload, attempts
               FROM event_outbox
              WHERE status = 'pending' AND next_attempt_at <= now()
              ORDER BY next_attempt_at, created_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1`
        );

        if (rows.length === 0) {
            await client.query('COMMIT');
            return false;
        }

        evento = rows[0];

        // Marcarlo antes de ejecutar evita que otro worker lo tome en paralelo.
        await client.query(
            `UPDATE event_outbox SET status = 'processing', attempts = attempts + 1 WHERE id = $1`,
            [evento.id]
        );
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        throw err;
    }

    client.release();

    // Los handlers corren fuera de la transaccion de reserva: si tardan, no
    // mantienen bloqueada la fila del outbox.
    try {
        const lista = handlers.get(evento.event_name) || [];
        for (const handler of lista) {
            await handler(evento.payload);
        }

        await db.query(
            `UPDATE event_outbox SET status = 'done', processed_at = now() WHERE id = $1`,
            [evento.id]
        );
    } catch (err) {
        const intentos = evento.attempts + 1;
        const agotado = intentos >= MAX_INTENTOS;

        // Backoff exponencial: 2s, 4s, 8s, 16s. Sin esta espera el worker
        // reintentaria el evento de inmediato dentro del mismo ciclo y
        // quemaria los cinco intentos en milisegundos.
        const esperaSegundos = Math.pow(2, intentos);

        await db.query(
            `UPDATE event_outbox
                SET status = $1,
                    last_error = $2,
                    next_attempt_at = now() + ($3 || ' seconds')::interval
              WHERE id = $4`,
            [agotado ? 'failed' : 'pending', String(err.message).slice(0, 1000), esperaSegundos, evento.id]
        );

        console.error(
            `[eventBus] fallo el evento ${evento.id} (${evento.event_name}), intento ${evento.attempts + 1}/${MAX_INTENTOS}: ${err.message}`
        );
    }

    return true;
}

/** Drena la cola hasta que no queden pendientes. */
async function procesarPendientes(maxPorTanda = 50) {
    if (procesando) return;   // evita solapamiento entre el timer y setImmediate
    procesando = true;
    try {
        let n = 0;
        while (n < maxPorTanda && await procesarUno()) n++;
    } finally {
        procesando = false;
    }
}

/**
 * Arranca el worker periodico. Se llama una sola vez, desde server.js.
 * El intervalo es la red de seguridad: recupera eventos que quedaron
 * pendientes de una caida previa o cuyo setImmediate fallo.
 */
function iniciarWorker(intervaloMs = INTERVALO_WORKER_MS) {
    if (workerTimer) return;
    workerTimer = setInterval(() => {
        procesarPendientes().catch(err =>
            console.error('[eventBus] error en el worker:', err.message)
        );
    }, intervaloMs);

    // No mantiene vivo el proceso si es lo unico que queda pendiente.
    if (workerTimer.unref) workerTimer.unref();

    console.log(`[eventBus] worker iniciado (cada ${intervaloMs} ms)`);
}

function detenerWorker() {
    if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
}

module.exports = {
    subscribe,
    publish,
    procesarPendientes,
    procesarUno,
    iniciarWorker,
    detenerWorker,
    MAX_INTENTOS
};
