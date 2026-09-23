/**
 * Plantillas de correo versionadas (criterio tecnico 2 de la HU de
 * notificaciones por correo).
 *
 * "Debo renderizar el contenido a partir de una plantilla identificada por
 * tipo de evento e idioma, y no debo construir el HTML del correo de forma
 * dinamica dentro de la logica de negocio de otros modulos."
 *
 * Por eso este archivo no sabe que es un curso ni una evaluacion: recibe un
 * tipo, un idioma y un diccionario de variables, y devuelve asunto, HTML y
 * texto. Los textos viven en email_templates (migracion 034), con su numero
 * de version; cambiarlos es insertar la version siguiente, no tocar codigo.
 *
 * La sintaxis es un subconjunto minimo de Mustache, a proposito:
 *
 *   {{variable}}                    -> valor (escapado en el HTML)
 *   {{#variable}}...{{/variable}}   -> el bloque si la variable esta presente
 *   {{^variable}}...{{/variable}}   -> el bloque si no lo esta
 *
 * "Presente" es distinto de null, undefined, false y ''. El 0 cuenta.
 *
 * Sin bucles ni expresiones: una plantilla con logica vuelve a ser codigo.
 */

const db = require('../config/db');

const IDIOMAS = ['es', 'en'];

/** Idioma de la plataforma cuando el usuario no eligio uno (criterio de aceptacion 3). */
function idiomaPorDefecto() {
    const valor = String(process.env.DEFAULT_LANGUAGE || 'es').toLowerCase();
    return IDIOMAS.includes(valor) ? valor : 'es';
}

/**
 * Idioma en el que sale un correo: el de la cuenta, o el de la plataforma.
 * Un valor fuera de catalogo se trata como "no configurado".
 */
function resolverIdioma(idiomaDelUsuario) {
    const valor = idiomaDelUsuario ? String(idiomaDelUsuario).toLowerCase() : null;
    return IDIOMAS.includes(valor) ? valor : idiomaPorDefecto();
}

/**
 * Version activa de la plantilla de un tipo en un idioma.
 *
 * Si ese idioma no tiene plantilla para el tipo, cae a la del idioma por
 * defecto: un correo en el idioma equivocado es mejor que ningun correo.
 *
 * @returns {Promise<object>} fila de email_templates
 * @throws si el tipo no tiene plantilla activa en ningun idioma
 */
async function obtenerPlantilla(tipo, idioma) {
    const candidatos = [...new Set([idioma, idiomaPorDefecto()])];

    for (const lang of candidatos) {
        const { rows } = await db.query(
            `SELECT id, notification_type, language, version, subject, body_html, body_text
               FROM email_templates
              WHERE notification_type = $1 AND language = $2 AND is_active
              LIMIT 1`,
            [tipo, lang]
        );
        if (rows[0]) return rows[0];
    }

    throw new Error(`no hay plantilla activa para "${tipo}" (idiomas probados: ${candidatos.join(', ')})`);
}

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

module.exports = {
    IDIOMAS,
    idiomaPorDefecto,
    resolverIdioma,
    obtenerPlantilla,
    renderizar,
    escaparHtml
};
