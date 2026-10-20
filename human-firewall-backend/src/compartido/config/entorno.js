/**
 * Lectura de variables de entorno.
 *
 * Capa de configuracion: ningun servicio deberia leer process.env "a mano"
 * para algo obligatorio, porque ahi es donde aparecen los valores por
 * defecto peligrosos. El caso que motivo este archivo es JWT_SECRET: si
 * faltaba, el middleware firmaba y verificaba con la cadena 'secret', y con
 * eso cualquiera podia fabricarse un token de admin.
 *
 * Las variables opcionales siguen teniendo su valor por defecto en el
 * servicio que las usa (estan documentadas en .env.example).
 */

/** Numero desde el entorno; si falta o no es un numero positivo, el defecto. */
function numero(nombre, defecto) {
    const n = Number(process.env[nombre]);
    return Number.isFinite(n) && n > 0 ? n : defecto;
}

/** Texto desde el entorno, o el defecto si esta vacio. */
function texto(nombre, defecto = '') {
    const v = process.env[nombre];
    return v === undefined || v === '' ? defecto : v;
}

/** Variable obligatoria: si falta, error explicito en lugar de un defecto inseguro. */
function obligatoria(nombre) {
    const v = process.env[nombre];
    if (v === undefined || v === '') {
        const e = new Error(
            `Falta la variable de entorno ${nombre}. Defini su valor en human-firewall-backend/.env ` +
            '(npm run setup lo genera).'
        );
        e.variable = nombre;
        throw e;
    }
    return v;
}

/** Secreto con el que se firman y verifican los JWT. Sin valor por defecto. */
function secretoJwt() {
    return obligatoria('JWT_SECRET');
}

/** Variables sin las cuales el servidor no debe arrancar. */
const OBLIGATORIAS = ['DATABASE_URL', 'JWT_SECRET'];

/** Lista de obligatorias que faltan (vacia si esta todo). */
function faltantes() {
    return OBLIGATORIAS.filter(n => !process.env[n]);
}

module.exports = { numero, texto, obligatoria, secretoJwt, OBLIGATORIAS, faltantes };
