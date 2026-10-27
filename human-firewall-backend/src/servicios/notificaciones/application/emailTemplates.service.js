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

const config = require('../config/configuracion');
const { IDIOMAS, escaparHtml, estaPresente, aplicar, renderizar } = require('../domain/plantilla');
const repo = require('../infrastructure/persistence/plantillas.repositorio');

/** Idioma de la plataforma cuando el usuario no eligio uno (criterio de aceptacion 3). */
function idiomaPorDefecto() {
    const valor = config.idiomaPorDefecto;
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
        const rows = await repo.plantillaActiva(tipo, lang);
        if (rows[0]) return rows[0];
    }

    throw new Error(`no hay plantilla activa para "${tipo}" (idiomas probados: ${candidatos.join(', ')})`);
}

module.exports = {
    IDIOMAS,
    idiomaPorDefecto,
    resolverIdioma,
    obtenerPlantilla,
    renderizar,
    escaparHtml
};
