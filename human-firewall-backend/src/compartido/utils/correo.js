/**
 * Validacion basica de direcciones de correo.
 *
 * La usan identidad (al invitar) y notificaciones (antes de encolar un
 * envio). Vivia en notificaciones/emailNotifications.service.js y por eso
 * identidad importaba un archivo interno de notificaciones. Es una utilidad
 * tecnica, sin reglas de negocio: va en compartido.
 *
 * No pretende ser RFC 5322: descarta lo que seguro no es un correo (vacio,
 * sin arroba, sin dominio, con espacios). Lo que pase este filtro y el
 * proveedor rechace cae como error permanente en el worker de correo.
 */
function esCorreoValido(email) {
    if (typeof email !== 'string') return false;
    const valor = email.trim();
    return valor.length > 0 && valor.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

module.exports = { esCorreoValido };
