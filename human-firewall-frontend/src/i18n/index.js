/**
 * Nucleo de traduccion: diccionarios, resolucion de claves e interpolacion.
 *
 * No usa ninguna libreria. El proyecto no tiene dependencias de interfaz
 * (ni UI kit, ni manejador de estado) y el tema ya se resuelve con un contexto
 * propio: una libreria de i18n aqui seria la unica de su clase, para un
 * problema que son dos funciones.
 *
 * Nada de esto toca React: son funciones puras, asi que la prueba de la HU
 * las puede ejercitar sin montar un componente.
 */

// Las extensiones van explicitas: Vite las resuelve sin ellas, pero la prueba
// de esta HU importa estos archivos con Node puro, que exige la extension.
import es from './es.js';
import en from './en.js';

/**
 * Diccionarios cargados.
 *
 * El codigo tiene que coincidir con el de `users.language` en el backend
 * (dominio/usuario.js). La lista de idiomas que el usuario PUEDE elegir no
 * sale de aca sino de GET /api/users/idiomas: esto es solo "para que idiomas
 * tenemos textos".
 */
export const DICCIONARIOS = { es, en };

/** El mismo de IDIOMA_POR_DEFECTO en el backend (criterio de aceptacion 5). */
export const IDIOMA_POR_DEFECTO = 'es';

/** Diccionario al que se cae cuando una clave no esta traducida. */
const DICCIONARIO_BASE = es;

export const hayDiccionario = (codigo) => Object.hasOwn(DICCIONARIOS, codigo);

/**
 * Busca una clave con puntos ('nav.desafios') dentro de un objeto anidado.
 * Devuelve undefined si falta cualquier tramo del camino.
 */
function buscar(diccionario, clave) {
    return String(clave).split('.').reduce(
        (nodo, tramo) => (nodo && typeof nodo === 'object' ? nodo[tramo] : undefined),
        diccionario
    );
}

/**
 * Reemplaza {marcadores} por valores.
 *
 * Un marcador sin valor se deja tal cual en lugar de imprimir "undefined":
 * un texto con un hueco visible se detecta y se arregla; un "undefined" en
 * medio de una frase parece un error de la aplicacion.
 */
function interpolar(texto, variables) {
    if (!variables) return texto;
    return texto.replace(/\{(\w+)\}/g, (original, nombre) =>
        (Object.hasOwn(variables, nombre) ? String(variables[nombre]) : original)
    );
}

/**
 * Devuelve el texto de `clave` en `idioma`.
 *
 * Tres caidas, en este orden:
 *   1. el diccionario del idioma pedido,
 *   2. el diccionario base (espanol), si al idioma le falta esa clave,
 *   3. la clave misma, para que una cadena inexistente se note en pantalla
 *      en vez de dejar un hueco en blanco.
 *
 * @param {string} idioma     codigo del idioma ('es', 'en')
 * @param {string} clave      clave con puntos, p.ej. 'preferencias.titulo'
 * @param {object} [variables] valores para los {marcadores} del texto
 */
export function traducir(idioma, clave, variables) {
    const diccionario = DICCIONARIOS[idioma] || DICCIONARIO_BASE;

    const propio = buscar(diccionario, clave);
    if (typeof propio === 'string') return interpolar(propio, variables);

    const base = buscar(DICCIONARIO_BASE, clave);
    if (typeof base === 'string') return interpolar(base, variables);

    return String(clave);
}

/**
 * Lista plana de las claves de un diccionario ('nav.desafios', ...).
 * La usa la prueba que verifica que los idiomas no se desincronicen.
 */
export function clavesDe(diccionario, prefijo = '') {
    return Object.entries(diccionario).flatMap(([nombre, valor]) => {
        const clave = prefijo ? `${prefijo}.${nombre}` : nombre;
        return (valor && typeof valor === 'object') ? clavesDe(valor, clave) : [clave];
    });
}
