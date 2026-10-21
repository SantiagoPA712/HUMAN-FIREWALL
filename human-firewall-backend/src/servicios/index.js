/**
 * Registro de los servicios de Human Firewall.
 *
 * Es la lista de los microservicios logicos del backend y el unico lugar
 * que los conoce a todos. app.js monta sus rutas a partir de aca y
 * suscriptores.js los conecta al bus de eventos.
 *
 * Cada servicio es una carpeta con la misma forma:
 *
 *   <servicio>/
 *     index.js          puerta publica: lo unico que otros servicios pueden usar
 *     manifiesto.js     ficha: responsabilidad, rutas, tablas, eventos, dependencias
 *     api/              capa de presentacion: rutas, controladores y DTO (esquemas.js)
 *     aplicacion/       capa de aplicacion: casos de uso
 *     dominio/          reglas puras, cuando el servicio las tiene
 *     infraestructura/  repositorios, clientes de otros servicios, integraciones
 *     contrato/         contrato OpenAPI de la API publica del servicio
 *
 * El orden importa solo para montar rutas: los servicios cuyas rutas
 * comparten un prefijo mas largo (/api/gamification/challenge,
 * /api/gamification/reports, ...) no chocan con /api/gamification porque
 * ese router no declara esos caminos. Ver tests/contratos.test.mjs.
 */

const SERVICIOS = [
    require('./identidad/index'),
    require('./cursos/index'),
    require('./evaluaciones/index'),
    require('./gamificacion/index'),
    require('./notificaciones/index'),
    require('./reportes/index'),
    require('./seguridad/index')
];

/** Busca un servicio por nombre. */
const servicio = (nombre) => SERVICIOS.find(s => s.manifiesto.nombre === nombre);

/** Todas las rutas a montar: [{ servicio, prefijo, router }]. */
function rutas() {
    return SERVICIOS.flatMap(s => s.rutas().map(r => ({ servicio: s.manifiesto.nombre, ...r })));
}

module.exports = { SERVICIOS, servicio, rutas };
