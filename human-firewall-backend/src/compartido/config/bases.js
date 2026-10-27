/**
 * Base de datos de cada microservicio.
 *
 * El material (secciones 1, 11 y 14) pide "base de datos por servicio" y "no
 * compartir base de datos entre servicios". Cada servicio declara la suya en
 * su config/configuracion.js (el application.yml del ejemplo:
 * "Configura conexion a base de datos propia") y la usa por
 * infrastructure/persistence/conexion.js.
 *
 * Dos modos, segun BASES_POR_SERVICIO:
 *
 *   true   cada servicio se conecta a su propia base. Por defecto se llama
 *          como la de DATABASE_URL con el nombre del servicio al final
 *          (human_firewall -> human_firewall_cursos); se puede fijar otra con
 *          CURSOS_DATABASE_URL, IDENTIDAD_DATABASE_URL, etc.
 *   false  todos usan la base de DATABASE_URL, cada uno en su esquema
 *          (identidad.*, cursos.*...). Es el modo de las pruebas y el de un
 *          proveedor que no deja crear varias bases.
 *
 * La base de DATABASE_URL sigue existiendo en los dos modos: es la de la
 * plataforma (cola de eventos sin transaccion y registro de migraciones).
 */

const { Pool } = require('pg');
const compartida = require('./db');

/** true si cada servicio usa su propia base. */
function porServicio() {
    // Por defecto si: es lo que pide el material. Con false, un esquema por
    // servicio dentro de la base compartida.
    return String(process.env.BASES_POR_SERVICIO || 'true').toLowerCase() !== 'false';
}

/** URL por defecto de la base de un servicio: la de DATABASE_URL con sufijo. */
function urlPorDefecto(servicio) {
    const url = process.env.DATABASE_URL || '';
    if (!porServicio() || !url) return url;
    const u = new URL(url);
    const nombre = u.pathname.replace(/^\//, '') || 'postgres';
    u.pathname = `/${nombre}_${servicio}`;
    return u.toString();
}

/** URL de la base de un servicio: <SERVICIO>_DATABASE_URL o la de por defecto. */
function urlDe(servicio) {
    return process.env[`${servicio.toUpperCase()}_DATABASE_URL`] || urlPorDefecto(servicio);
}

const pools = new Map();

/**
 * Conexion (pool) de una base. Si la URL es la de DATABASE_URL, o si la base
 * compartida no es un Pool real (las pruebas inyectan PGlite en su lugar), se
 * usa la compartida.
 */
function baseDe(url) {
    if (!url || url === process.env.DATABASE_URL || !(compartida instanceof Pool)) return compartida;
    if (!pools.has(url)) {
        const esRemota = /supabase|neon\.tech|render\.com|amazonaws\.com|azure|heroku/i.test(url);
        const pool = new Pool({
            connectionString: url,
            ssl: (esRemota || process.env.DB_SSL === 'true') ? { rejectUnauthorized: false } : false
        });
        pool.on('connect', (client) => {
            client.query(`SET search_path TO ${compartida.SEARCH_PATH}`).catch(() => {});
        });
        pools.set(url, pool);
    }
    return pools.get(url);
}

/** Todas las bases en uso (la compartida y las de cada servicio), sin repetir. */
function todas() {
    return [compartida, ...pools.values()];
}

/** Cierra las bases propias de los servicios (al apagar el servidor). */
async function cerrar() {
    await Promise.all([...pools.values()].map(p => p.end().catch(() => {})));
    pools.clear();
}

module.exports = { porServicio, urlPorDefecto, urlDe, baseDe, todas, cerrar };
