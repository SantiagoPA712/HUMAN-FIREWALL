/**
 * Conexion a la base de datos propia del servicio de seguridad.
 *
 * Capa Infrastructure / Persistence (seccion 11 del material). La URL sale
 * de config/configuracion.js (baseDeDatos), igual que el application.yml del
 * ejemplo configura "conexion a base de datos propia". Los repositorios de
 * este servicio usan solo esta conexion: nunca la de otro servicio.
 *
 * Con BASES_POR_SERVICIO=false (pruebas, o un proveedor con una sola base)
 * resuelve a la base compartida, donde el servicio tiene su esquema.
 */

const { baseDe } = require('../../../../compartido/config/bases');
const transaccion = require('../../../../compartido/config/transaccion');
const config = require('../../config/configuracion');

// Se resuelve en cada uso (y no al cargar el modulo) para respetar el .env y
// la base que inyectan las pruebas.
const base = () => baseDe(config.baseDeDatos);

module.exports = {
    query: (...args) => base().query(...args),
    connect: () => base().connect(),
    /** Cierra la conexion (scripts sueltos, como seed_admin.js). */
    end: () => (base().end ? base().end() : undefined),
    /** Unidad de trabajo sobre la base del servicio (BEGIN/COMMIT/ROLLBACK). */
    conTransaccion: (trabajo) => transaccion.conTransaccion(trabajo, base())
};
