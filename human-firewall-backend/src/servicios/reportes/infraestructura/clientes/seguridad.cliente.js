/** Cliente del servicio de seguridad, visto desde reportes. */
const seguridad = () => require('../../../seguridad');

module.exports = {
    registrarAccion: (datos) => seguridad().registrarAccion(datos),
    get ACCIONES() { return seguridad().ACCIONES; },
    get MODULOS() { return seguridad().MODULOS; }
};
