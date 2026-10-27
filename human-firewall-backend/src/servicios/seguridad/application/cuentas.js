/**
 * Correos de las cuentas para los listados de seguridad.
 *
 * Capa Application / Service. Las cuentas son de identidad, que tiene su
 * propia base: en lugar de un JOIN con identidad.users, se piden por su
 * contrato los correos de todas las filas de una vez y se agregan en memoria.
 */

const identidad = require('../infrastructure/client/identidad.cliente');

/**
 * Agrega a cada fila los datos de la cuenta referida en `campoId`.
 *
 * @param {object[]} filas
 * @param {Array<{campoId: string, correo: string, rol?: string, obligatoria?: boolean}>} referencias
 *        obligatoria=true se comporta como el JOIN de antes: si la cuenta no
 *        existe, la fila no se muestra. false se comporta como un LEFT JOIN.
 */
async function conCuentas(filas, referencias) {
    if (filas.length === 0) return filas;
    const ids = filas.flatMap(f => referencias.map(r => f[r.campoId]));
    const cuentas = new Map((await identidad.resumenesDe(ids)).map(c => [c.id, c]));

    return filas
        .filter(f => referencias.every(r => !r.obligatoria || cuentas.has(f[r.campoId])))
        .map(f => {
            const fila = { ...f };
            for (const r of referencias) {
                const cuenta = cuentas.get(f[r.campoId]) || null;
                fila[r.correo] = cuenta ? cuenta.email : null;
                if (r.rol) fila[r.rol] = cuenta ? cuenta.role : null;
            }
            return fila;
        });
}

module.exports = { conCuentas };
