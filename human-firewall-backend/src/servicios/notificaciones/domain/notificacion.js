/**
 * Notificaciones (servicio de notificaciones).
 *
 * Capa Domain (seccion 11 del material): Reglas de una notificacion: canales, estados de entrega y largo maximo del titulo.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

/** Los dos canales del criterio tecnico 3. */
const CANALES = ['in_app', 'email'];

/** Estados de entrega del criterio tecnico 5. */
const ESTADOS = ['generada', 'entregada', 'fallida', 'leida'];

/** Largo de notifications.title (migracion 009). */
const LARGO_TITULO = 150;

/**
 * Recorta un titulo para que entre en notifications.title.
 *
 * FALLO CORREGIDO: los titulos se armaban interpolando datos sin acotar.
 * `courses.title` admite 255 caracteres y `users.email` otros 255, contra los
 * 150 de `notifications.title`. Un curso con un titulo largo pero
 * perfectamente valido hacia fallar el INSERT, y entonces el usuario no se
 * enteraba de su resultado: el evento agotaba sus cinco reintentos y moria.
 *
 * Se recorta el titulo y no se amplia la columna porque la columna es de la
 * migracion 009, ya mergeada, y el titulo es un resumen: el dato completo
 * viaja en el cuerpo, que es TEXT y no tiene limite.
 */
function recortarTitulo(texto) {
    const t = String(texto);
    return t.length <= LARGO_TITULO ? t : `${t.slice(0, LARGO_TITULO - 1)}…`;
}

module.exports = { CANALES, ESTADOS, LARGO_TITULO, recortarTitulo };
