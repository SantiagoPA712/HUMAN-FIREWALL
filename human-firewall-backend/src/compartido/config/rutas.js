/**
 * Rutas del sistema de archivos que usan varios servicios.
 *
 * Antes cada archivo armaba la suya con path.join(__dirname, '..', '..'),
 * asi que la ruta dependia de en que carpeta estuviera el archivo. Al
 * reorganizar el backend por servicios esos calculos quedaban apuntando a
 * cualquier lado. Ahora se calculan una sola vez, aca, y el resto las importa.
 */

const path = require('path');

/** human-firewall-backend/ */
const RAIZ_BACKEND = path.join(__dirname, '..', '..', '..');

/** Raiz del repositorio (donde viven migrations/ y schema.sql). */
const RAIZ_REPO = path.join(RAIZ_BACKEND, '..');

/** Archivos generados en tiempo de ejecucion (exportaciones y reportes). */
const DIR_STORAGE = path.join(RAIZ_BACKEND, 'storage');

/** Build de React que sirve el monolito. */
const DIR_FRONTEND_BUILD = path.join(RAIZ_REPO, 'human-firewall-frontend', 'dist');

module.exports = { RAIZ_BACKEND, RAIZ_REPO, DIR_STORAGE, DIR_FRONTEND_BUILD };
