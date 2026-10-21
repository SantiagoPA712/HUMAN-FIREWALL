/** Cliente del servicio de seguridad, visto desde reportes. */
const seguridad = () => require('../../../seguridad/index');

module.exports = {
    registrarAccion: (datos) => seguridad().registrarAccion(datos),
    get ACCIONES() { return seguridad().ACCIONES; },
    get MODULOS() { return seguridad().MODULOS; }
};
