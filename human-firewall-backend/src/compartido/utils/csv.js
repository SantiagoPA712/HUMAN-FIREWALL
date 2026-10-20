/**
 * Escapado de valores para CSV.
 *
 * Lo usan reportes (exportaciones de desempeno y organizacional) y seguridad
 * (exportacion de data.logs). Vivia en reportes/reportExports.service.js, y
 * por eso seguridad importaba un archivo interno de reportes solo para usar
 * esta funcion. Es una utilidad tecnica sin reglas de negocio: va en
 * compartido.
 *
 * Ademas de comillas y saltos de linea, neutraliza la inyeccion de formulas
 * (CSV injection): un valor que empieza con = + - @ se abre en Excel como
 * formula. Se le antepone un apostrofo para que se lea como texto.
 */
function escaparCSV(valor) {
    let texto = valor == null ? '' : String(valor);

    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;

    if (/[",\n\r]/.test(texto)) {
        texto = `"${texto.replace(/"/g, '""')}"`;
    }
    return texto;
}

module.exports = { escaparCSV };
