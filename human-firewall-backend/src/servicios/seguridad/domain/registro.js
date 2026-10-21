/**
 * Registro de actividad (servicio de seguridad).
 *
 * Capa Domain (seccion 11 del material): Regla de privacidad de los logs: que datos se enmascaran antes de guardarse.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

/**
 * Claves cuyo valor nunca se guarda. Se compara contra el NOMBRE del campo,
 * no contra el valor: "password", "newPassword", "reset_token", "api_key",
 * "Authorization"...
 */
const CLAVE_SENSIBLE = /pass(word)?|pwd|token|secret|authorization|cookie|api[_-]?key|credential|hash/i;

/**
 * Valores que delatan un secreto aunque vengan en un campo con nombre
 * inocente (un JWT o un hash bcrypt pegados en "nota", por ejemplo).
 */
const VALOR_SENSIBLE = [
    /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/,   // JWT
    /^\$2[aby]\$\d{2}\$/              // hash bcrypt
];

const REDACTADO = '[REDACTED]';

/**
 * Devuelve una copia del valor sin secretos.
 *
 * No borra el campo: lo reemplaza por "[REDACTED]". El criterio pide "un
 * indicador de que el campo cambio", y un campo ausente no dice nada; uno
 * redactado dice "aca hubo una contrasena y cambio".
 *
 * @param {*} valor
 * @param {number} [profundidad]  corta estructuras circulares o absurdas
 */
function enmascarar(valor, profundidad = 0) {
    if (valor === null || valor === undefined) return valor ?? null;
    if (profundidad > 8) return '[TRUNCATED]';

    if (typeof valor === 'string') {
        return VALOR_SENSIBLE.some(r => r.test(valor)) ? REDACTADO : valor;
    }

    if (valor instanceof Date) return valor.toISOString();

    if (Array.isArray(valor)) {
        return valor.map(v => enmascarar(v, profundidad + 1));
    }

    if (typeof valor === 'object') {
        const limpio = {};
        for (const [clave, v] of Object.entries(valor)) {
            if (v === undefined) continue;
            limpio[clave] = CLAVE_SENSIBLE.test(clave)
                ? REDACTADO
                : enmascarar(v, profundidad + 1);
        }
        return limpio;
    }

    // number, boolean
    return valor;
}

module.exports = { CLAVE_SENSIBLE, VALOR_SENSIBLE, REDACTADO, enmascarar };
