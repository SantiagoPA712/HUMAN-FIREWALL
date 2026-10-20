/** Cliente del servicio de identidad, visto desde gamificacion. */
const identidad = () => require('../../../identidad');

module.exports = {
    /** true si existe una cuenta con ese id. */
    usuarioExiste: (userId) => identidad().usuarioExiste(userId)
};
