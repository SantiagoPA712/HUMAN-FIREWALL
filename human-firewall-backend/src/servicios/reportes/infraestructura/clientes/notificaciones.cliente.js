/** Cliente del servicio de notificaciones, visto desde reportes. */
const notificaciones = () => require('../../../notificaciones');

module.exports = {
    notificar: (evento, aviso, userId) => notificaciones().notificar(evento, aviso, userId),
    reenviarCorreo: (datos) => notificaciones().reenviarCorreo(datos)
};
