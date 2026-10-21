/**
 * Unidad de trabajo: ejecuta varias operaciones en una sola transaccion.
 *
 * La capa de aplicacion decide QUE va junto en una transaccion (por ejemplo,
 * crear la cuenta y encolar user.registered); los repositorios saben COMO se
 * escribe cada cosa. Este helper es el puente: la aplicacion no importa el
 * pool de conexiones ni escribe BEGIN/COMMIT, y los repositorios reciben el
 * cliente de la transaccion como parametro `tx`.
 *
 *   const resultado = await conTransaccion(async (tx) => {
 *       const usuario = await usuarios.insertar({...}, tx);
 *       await eventBus.publish(EVENTOS.USER_REGISTERED, {...}, tx);
 *       return usuario;
 *   });
 *
 * Si cualquier paso lanza, se hace ROLLBACK y el error sigue su camino.
 */

const db = require('./db');

async function conTransaccion(trabajo) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resultado = await trabajo(client);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { conTransaccion };
