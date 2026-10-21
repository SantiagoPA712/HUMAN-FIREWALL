/**
 * Plantillas de correo (servicio de notificaciones).
 *
 * Capa Domain (seccion 11 del material): Reglas de las plantillas: idiomas soportados, secciones condicionales, variables obligatorias y escapado HTML.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

const IDIOMAS = ['es', 'en'];

function escaparHtml(valor) {
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Si una seccion {{#x}} se muestra. No es la veracidad de JavaScript: un
 * puntaje de 0 es un dato presente y se tiene que ver. Solo cuentan como
 * ausentes null, undefined, false y la cadena vacia.
 */
function estaPresente(valor) {
    return valor !== undefined && valor !== null && valor !== false && valor !== '';
}

/**
 * Aplica las variables a un texto de plantilla.
 *
 * Una variable que la plantilla usa y no vino es un error, no una cadena
 * vacia: un correo que dice "Hola , te asignaron el curso ." sale igual y
 * nadie se entera de que la plantilla y el codigo se desincronizaron.
 *
 * @param {string}  texto
 * @param {object}  variables
 * @param {boolean} html  true escapa los valores
 */
function aplicar(texto, variables, { html = false } = {}) {
    const conSecciones = texto.replace(
        /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g,
        (_, tipo, clave, dentro) => {
            const presente = estaPresente(variables[clave]);
            return (tipo === '#' ? presente : !presente) ? dentro : '';
        }
    );

    return conSecciones.replace(/\{\{(\w+)\}\}/g, (_, clave) => {
        if (variables[clave] === undefined || variables[clave] === null) {
            throw new Error(`la plantilla usa {{${clave}}} y no se envio ese dato`);
        }
        return html ? escaparHtml(variables[clave]) : String(variables[clave]);
    });
}

/**
 * Renderiza una plantilla ya obtenida.
 *
 * @returns {{subject: string, html: string, text: string}}
 */
function renderizar(plantilla, variables = {}) {
    return {
        subject: aplicar(plantilla.subject, variables).replace(/\s+/g, ' ').trim(),
        html: aplicar(plantilla.body_html, variables, { html: true }),
        text: aplicar(plantilla.body_text, variables)
    };
}

module.exports = { IDIOMAS, escaparHtml, estaPresente, aplicar, renderizar };
