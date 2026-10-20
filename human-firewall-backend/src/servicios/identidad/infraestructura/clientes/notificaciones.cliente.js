/** Cliente del servicio de notificaciones, visto desde identidad. */
const notificaciones = () => require('../../../notificaciones');

module.exports = {
    /** Deja un aviso en la bandeja in-app de un usuario, sin correo. */
    avisarEnBandeja: (evento, aviso, userId) => notificaciones().avisarEnBandeja(evento, aviso, userId)
};
