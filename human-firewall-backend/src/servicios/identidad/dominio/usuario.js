/**
 * Reglas del dominio de identidad. Funciones y constantes puras.
 */

/** Mismos valores que el CHECK de users.role (migracion 032). */
const ROLES = ['employee', 'instructor', 'admin', 'rh', 'security', 'manager'];

/** Mismos valores que el CHECK de users.language (migracion 034). */
const IDIOMAS = ['es', 'en'];

/** Politica de contrasena: minimo 8 caracteres, una mayuscula y un numero. */
const POLITICA_CONTRASENA = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const MENSAJE_POLITICA = 'La contraseña debe tener mínimo 8 caracteres, al menos una mayúscula y un número';

const cumplePolitica = (password) => typeof password === 'string' && POLITICA_CONTRASENA.test(password);

module.exports = { ROLES, IDIOMAS, POLITICA_CONTRASENA, MENSAJE_POLITICA, cumplePolitica };
