/**
 * Analizador estatico de la arquitectura.
 *
 * Lee el codigo de cada servicio y responde tres preguntas que la HU de
 * microservicios por capas convierte en reglas verificables:
 *
 *   1. De que otros servicios depende un archivo (por sus require).
 *   2. Que tablas lee y cuales escribe (por el SQL que contiene).
 *   3. Que eventos publica y a cuales se suscribe.
 *
 * No ejecuta nada: solo lee texto. Lo usan las pruebas de arquitectura
 * (tests/arquitectura.test.mjs) y el generador de la documentacion.
 */

const fs = require('fs');
const path = require('path');

const DIR_SRC = path.join(__dirname, '..', '..');
const DIR_SERVICIOS = path.join(DIR_SRC, 'servicios');

/** Lista recursiva de archivos .js de una carpeta. */
function listarJs(dir) {
    if (!fs.existsSync(dir)) return [];
    const salida = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) salida.push(...listarJs(p));
        else if (e.name.endsWith('.js')) salida.push(p);
    }
    return salida;
}

/** Nombres de las carpetas de servicios (identidad, cursos, ...). */
function listarServicios() {
    return fs.readdirSync(DIR_SERVICIOS, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
}

/** Quita comentarios para no confundir prosa con codigo. */
function sinComentarios(codigo) {
    return codigo
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * require relativos de un archivo, ya resueltos a rutas absolutas.
 * Solo los relativos: los paquetes de node_modules no son dependencias
 * entre servicios.
 */
function requiresDe(archivo) {
    const codigo = sinComentarios(fs.readFileSync(archivo, 'utf8'));
    const salida = [];
    const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(codigo))) {
        const base = path.resolve(path.dirname(archivo), m[1]);
        const candidatos = [base, `${base}.js`, path.join(base, 'index.js')];
        const real = candidatos.find(c => fs.existsSync(c) && fs.statSync(c).isFile()) || base;
        salida.push({ especificador: m[1], destino: real });
    }
    return salida;
}

/** A que servicio pertenece una ruta absoluta (o null si es compartido u otro). */
function servicioDe(archivo) {
    const rel = path.relative(DIR_SERVICIOS, archivo);
    if (rel.startsWith('..')) return null;
    return rel.split(path.sep)[0];
}

/** Capa de un archivo dentro de su servicio: api, aplicacion, dominio, ... */
function capaDe(archivo) {
    const rel = path.relative(DIR_SERVICIOS, archivo).split(path.sep);
    return rel.length > 2 ? rel[1] : '(raiz)';
}

/**
 * Tablas referenciadas por el SQL del archivo, separadas en lecturas y
 * escrituras. Se buscan solo dentro de cadenas que parecen SQL, para no
 * tomar como tabla una palabra cualquiera de un mensaje.
 */
function tablasDe(archivo) {
    const codigo = sinComentarios(fs.readFileSync(archivo, 'utf8'));
    const cadenas = codigo.match(/`[^`]*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
    const sql = cadenas.filter(c => /\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b/.test(c));

    const lecturas = new Set();
    const escrituras = new Set();
    const nombre = '([a-z_][a-z0-9_]*(?:\\.[a-z_][a-z0-9_]*)?)';

    for (const s of sql) {
        // Nombres de CTE (WITH x AS (...), y AS (...)): no son tablas.
        const ctes = new Set();
        const reCte = /(?:\bWITH(?:\s+RECURSIVE)?|,)\s+([a-z_][a-z0-9_]*)\s+AS\s+(?:NOT\s+)?(?:MATERIALIZED\s+)?\(/gi;
        let c;
        while ((c = reCte.exec(s))) ctes.add(c[1].toLowerCase());

        // Escrituras
        for (const re of [
            new RegExp(`\\bINSERT\\s+INTO\\s+${nombre}`, 'gi'),
            new RegExp(`\\bUPDATE\\s+${nombre}\\s+(?:[a-z]+\\s+)?SET\\b`, 'gi'),
            new RegExp(`\\bDELETE\\s+FROM\\s+${nombre}`, 'gi')
        ]) {
            let m;
            while ((m = re.exec(s))) escrituras.add(m[1].toLowerCase());
        }
        // Lecturas (FROM y JOIN que no sean parte de un DELETE FROM)
        const re = new RegExp(`(?<!DELETE\\s{1,5})\\b(?:FROM|JOIN)\\s+${nombre}`, 'gi');
        let m;
        while ((m = re.exec(s))) {
            const t = m[1].toLowerCase();
            // Funciones y palabras clave que pueden seguir a FROM.
            if (['unnest', 'generate_series', 'jsonb_array_elements', 'jsonb_each', 'json_each',
                 'lateral', 'only', 'jsonb_to_recordset', 'regexp_split_to_table'].includes(t)) continue;
            if (ctes.has(t)) continue;
            lecturas.add(t);
        }
    }
    return { lecturas: [...lecturas], escrituras: [...escrituras] };
}

/** Eventos publicados y suscritos (por constante del catalogo). */
function eventosDe(archivo) {
    const codigo = sinComentarios(fs.readFileSync(archivo, 'utf8'));
    const pub = new Set();
    const sub = new Set();
    let m;
    const rePub = /publish\(\s*EVENTOS\.([A-Z_]+)/g;
    while ((m = rePub.exec(codigo))) pub.add(m[1]);
    const reSub = /subscribe\(\s*EVENTOS\.([A-Z_]+)/g;
    while ((m = reSub.exec(codigo))) sub.add(m[1]);
    return { publica: [...pub], consume: [...sub] };
}

/** Resumen de todo un servicio. */
function analizarServicio(nombre) {
    const archivos = listarJs(path.join(DIR_SERVICIOS, nombre));
    return archivos.map(archivo => ({
        archivo,
        relativo: path.relative(DIR_SRC, archivo).replace(/\\/g, '/'),
        capa: capaDe(archivo),
        requires: requiresDe(archivo),
        ...tablasDe(archivo),
        ...eventosDe(archivo)
    }));
}

module.exports = {
    DIR_SRC,
    DIR_SERVICIOS,
    listarJs,
    listarServicios,
    requiresDe,
    servicioDe,
    capaDe,
    tablasDe,
    eventosDe,
    analizarServicio
};
