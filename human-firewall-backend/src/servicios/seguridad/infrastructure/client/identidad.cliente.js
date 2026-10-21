/** Cliente del servicio de identidad, visto desde seguridad. */
const identidad = () => require('../../../identidad/index');

module.exports = {
    /** Correo de una cuenta, o null. */
    correoDe: (userId) => identidad().correoDe(userId),
    /** Id de la cuenta con ese correo, o null. */
    idPorCorreo: (email) => identidad().idPorCorreo(email)
};
