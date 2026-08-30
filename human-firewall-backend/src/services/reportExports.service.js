/**
 * Exportacion de reportes a CSV y PDF.
 *
 * HU de reportes, criterio de aceptacion 3 y criterios tecnicos 5 y 6.
 *
 * ---------------------------------------------------------------------
 * Sincrono o asincrono, segun el volumen (criterio tecnico 5)
 * ---------------------------------------------------------------------
 * Un reporte de 30 filas se genera y se devuelve en el mismo request: pedirle
 * a RH que espere un job para descargar media pantalla seria absurdo.
 *
 * Uno de 20.000 no puede: generar el PDF bloquea el proceso (Node es de un
 * solo hilo) y el navegador cortaria por timeout. A partir del umbral se
 * encola y se responde 202 con un identificador.
 *
 * El umbral es configurable por entorno (REPORT_EXPORT_SYNC_LIMIT), como pide
 * el criterio: 5000 filas por defecto.
 *
 * ---------------------------------------------------------------------
 * Por que el bus de eventos y no un setTimeout
 * ---------------------------------------------------------------------
 * El proyecto ya tiene una cola con reintentos y persistencia (event_outbox).
 * Un `setTimeout(generar, 0)` se perderia al reiniciar el proceso y dejaria la
 * exportacion en 'pending' para siempre, sin que nadie lo note. Publicando
 * report.export_requested se hereda el worker, el backoff y el diagnostico
 * que ya existen.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../config/db');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');
const reportsService = require('./reports.service');

/** Umbral configurable. Por encima de esto, la exportacion se encola. */
const LIMITE_SINCRONO = Number(process.env.REPORT_EXPORT_SYNC_LIMIT) || 5000;

/** Donde quedan los archivos generados. Fuera del control de versiones. */
const DIR_EXPORTS = path.join(__dirname, '..', '..', 'storage', 'exports');

const FORMATOS = ['csv', 'pdf'];

/** Columnas del archivo, en orden. Mismas que la tabla del mockup. */
const COLUMNAS = [
    { clave: 'email',            titulo: 'Usuario',          ancho: 170 },
    { clave: 'equipo',           titulo: 'Equipo',           ancho: 90  },
    { clave: 'puntos',           titulo: 'Puntos',           ancho: 50  },
    { clave: 'nivel_texto',      titulo: 'Nivel',            ancho: 95  },
    { clave: 'insignias',        titulo: 'Insignias',        ancho: 55  },
    { clave: 'ultima_actividad', titulo: 'Ultima actividad', ancho: 90  }
];

function asegurarDirectorio() {
    fs.mkdirSync(DIR_EXPORTS, { recursive: true });
}

/** Fila del reporte -> fila plana para el archivo. */
function aplanar(fila) {
    return {
        email: fila.email,
        equipo: fila.equipo,
        puntos: fila.puntos,
        nivel_texto: fila.nivel != null ? `${fila.nivel} - ${fila.nivel_nombre}` : 'Sin nivel',
        insignias: fila.insignias,
        ultima_actividad: fila.ultima_actividad
            ? new Date(fila.ultima_actividad).toISOString().slice(0, 10)
            : 'Sin actividad'
    };
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------

/**
 * Escapa un valor para CSV.
 *
 * Ademas de las comillas y los separadores, se neutraliza la inyeccion de
 * formulas: si un campo empieza con =, +, - o @, Excel lo interpreta como
 * formula al abrir el archivo. Con un correo tipo "=cmd|..." eso se convierte
 * en ejecucion de comandos en la maquina de quien abre el reporte. Anteponer
 * un apostrofo lo fuerza a texto.
 */
function escaparCSV(valor) {
    let texto = valor == null ? '' : String(valor);

    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;

    if (/[",\n\r]/.test(texto)) {
        texto = `"${texto.replace(/"/g, '""')}"`;
    }
    return texto;
}

function generarCSV(filas) {
    const lineas = [COLUMNAS.map(c => escaparCSV(c.titulo)).join(',')];

    for (const fila of filas) {
        const plana = aplanar(fila);
        lineas.push(COLUMNAS.map(c => escaparCSV(plana[c.clave])).join(','));
    }

    // BOM UTF-8: sin el, Excel en Windows abre el archivo en la codificacion
    // del sistema y los acentos aparecen rotos.
    return Buffer.from('﻿' + lineas.join('\r\n'), 'utf8');
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------

/** Texto legible de los filtros, para el encabezado del PDF. */
function describirFiltros(filtros, nombres = {}) {
    const partes = [];
    if (filtros.from || filtros.to) {
        partes.push(`Periodo: ${filtros.from || 'inicio'} a ${filtros.to || 'hoy'}`);
    }
    if (filtros.teamId) partes.push(`Equipo: ${nombres.equipo || filtros.teamId}`);
    if (filtros.courseId) partes.push(`Curso: ${nombres.curso || filtros.courseId}`);
    return partes.length > 0 ? partes.join('   |   ') : 'Sin filtros: todos los usuarios activos';
}

function generarPDF(filas, filtros, nombres) {
    // Se carga aca y no arriba para que el modulo se pueda importar en las
    // pruebas de CSV sin arrastrar la libreria entera.
    const PDFDocument = require('pdfkit');

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
        const trozos = [];
        doc.on('data', t => trozos.push(t));
        doc.on('end', () => resolve(Buffer.concat(trozos)));
        doc.on('error', reject);

        doc.fontSize(16).fillColor('#1F3864').text('Reporte de desempeno', { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor('#444')
           .text(describirFiltros(filtros, nombres))
           .text(`Generado: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC   |   ${filas.length} registros`);
        doc.moveDown(0.8);

        const inicioX = doc.x;
        let y = doc.y;

        const encabezado = () => {
            doc.fontSize(9).fillColor('#000');
            let x = inicioX;
            for (const c of COLUMNAS) {
                doc.font('Helvetica-Bold').text(c.titulo, x, y, { width: c.ancho, ellipsis: true });
                x += c.ancho;
            }
            y += 16;
            doc.moveTo(inicioX, y - 4).lineTo(inicioX + COLUMNAS.reduce((a, c) => a + c.ancho, 0), y - 4)
               .strokeColor('#999').stroke();
        };

        encabezado();

        for (const fila of filas) {
            // Salto de pagina: sin esto las filas se dibujan una encima de
            // otra al pasar del alto util de la hoja.
            if (y > doc.page.height - 50) {
                doc.addPage();
                y = doc.y;
                encabezado();
            }

            const plana = aplanar(fila);
            let x = inicioX;
            doc.font('Helvetica').fontSize(8).fillColor('#222');
            for (const c of COLUMNAS) {
                doc.text(String(plana[c.clave]), x, y, { width: c.ancho - 4, ellipsis: true });
                x += c.ancho;
            }
            y += 14;
        }

        doc.end();
    });
}

// ---------------------------------------------------------------------
// Registro y auditoria (criterio tecnico 6)
// ---------------------------------------------------------------------

/**
 * Crea la fila de auditoria y devuelve el identificador publico.
 *
 * Se registra ANTES de generar nada: si la generacion falla, la solicitud
 * igual queda auditada. Una auditoria que solo guarda los exitos no sirve
 * para responder "quien intento llevarse estos datos".
 */
async function registrarSolicitud({ userId, formato, filtros, estado }) {
    // Identificador aleatorio y no el id secuencial: con /exports/41 se puede
    // probar 40, 39, 38 y enumerar las exportaciones de otros.
    const exportUid = crypto.randomBytes(16).toString('hex');

    const { rows } = await db.query(
        `INSERT INTO report_exports
            (export_uid, requested_by, report_type, format, filters, status)
         VALUES ($1, $2, 'performance', $3, $4, $5)
         RETURNING id, export_uid, status, created_at`,
        [exportUid, userId, formato, JSON.stringify(filtros), estado]
    );

    // Criterio 6: queda tambien en el log del servidor. Es el unico lugar
    // donde esta informacion aparece; nunca sale por la API.
    console.log(
        `[reportes] exportacion solicitada uid=${exportUid} por usuario=${userId} ` +
        `formato=${formato} filtros=${JSON.stringify(filtros)} en=${rows[0].created_at.toISOString()}`
    );

    return rows[0];
}

async function marcarListo(exportUid, { fileName, filas }) {
    await db.query(
        `UPDATE report_exports
            SET status = 'ready', file_name = $2, row_count = $3, completed_at = now()
          WHERE export_uid = $1`,
        [exportUid, fileName, filas]
    );
}

async function marcarFallido(exportUid, mensaje) {
    await db.query(
        `UPDATE report_exports
            SET status = 'failed', error = $2, completed_at = now()
          WHERE export_uid = $1`,
        [exportUid, mensaje]
    );
}

// ---------------------------------------------------------------------
// Generacion
// ---------------------------------------------------------------------

/** Nombres legibles del equipo y el curso filtrados, para el encabezado del PDF. */
async function resolverNombres(filtros) {
    const nombres = {};
    if (filtros.teamId) {
        const { rows } = await db.query('SELECT name FROM teams WHERE id = $1', [filtros.teamId]);
        if (rows[0]) nombres.equipo = rows[0].name;
    }
    if (filtros.courseId) {
        const { rows } = await db.query('SELECT title FROM courses WHERE id = $1', [filtros.courseId]);
        if (rows[0]) nombres.curso = rows[0].title;
    }
    return nombres;
}

/**
 * Genera el archivo y lo devuelve en memoria.
 * @returns {Promise<{buffer: Buffer, fileName: string, mime: string, filas: number}>}
 */
async function generarArchivo({ exportUid, formato, filtros }) {
    const filas = await reportsService.obtenerTodasLasFilas(filtros);
    const nombres = await resolverNombres(filtros);

    const buffer = formato === 'pdf'
        ? await generarPDF(filas, filtros, nombres)
        : generarCSV(filas);

    // Criterio tecnico 5: nombre generado por el sistema, sin datos sensibles.
    // Nada de correos, equipos ni rangos de fecha: el nombre de un archivo
    // viaja en encabezados HTTP, en el historial de descargas del navegador y
    // en los logs de cualquier proxy intermedio.
    const fileName = `reporte-desempeno-${exportUid}.${formato}`;

    return {
        buffer,
        fileName,
        filas: filas.length,
        mime: formato === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8'
    };
}

/** Guarda el archivo en disco. Solo para el camino asincrono. */
function guardarEnDisco(fileName, buffer) {
    asegurarDirectorio();
    fs.writeFileSync(path.join(DIR_EXPORTS, fileName), buffer);
}

/**
 * Punto de entrada del controlador.
 *
 * Decide entre generar en el momento o encolar, segun el volumen.
 *
 * @returns {Promise<{modo: 'sincrono', archivo: object} | {modo: 'asincrono', exportUid: string, total: number}>}
 */
async function solicitarExportacion({ userId, formato, filtros }) {
    if (!FORMATOS.includes(formato)) {
        const error = new Error(`Formato no soportado: "${formato}". Use csv o pdf.`);
        error.campo = 'format';
        throw error;
    }

    // Se cuenta antes de decidir. Es una consulta barata (COUNT) frente a
    // generar un PDF de miles de filas para descubrir a mitad de camino que
    // era demasiado grande.
    const total = await reportsService.contarUsuarios(filtros);
    const esGrande = total > LIMITE_SINCRONO;

    const registro = await registrarSolicitud({
        userId,
        formato,
        filtros,
        estado: esGrande ? 'pending' : 'processing'
    });

    if (esGrande) {
        // El worker lo toma por fuera del request.
        await eventBus.publish(EVENTOS.REPORT_EXPORT_REQUESTED, {
            exportUid: registro.export_uid,
            userId,
            formato,
            filtros
        });

        return { modo: 'asincrono', exportUid: registro.export_uid, total };
    }

    try {
        const archivo = await generarArchivo({
            exportUid: registro.export_uid, formato, filtros
        });
        await marcarListo(registro.export_uid, {
            fileName: archivo.fileName, filas: archivo.filas
        });
        return { modo: 'sincrono', archivo, exportUid: registro.export_uid };
    } catch (err) {
        await marcarFallido(registro.export_uid, err.message);
        throw err;
    }
}

/**
 * Handler del evento: genera el archivo encolado y lo deja en disco.
 *
 * Idempotente, como exige el bus: si el worker reintenta una exportacion que
 * ya quedo lista, no la vuelve a generar.
 */
async function procesarExportacion({ exportUid, formato, filtros }) {
    const { rows } = await db.query(
        'SELECT status FROM report_exports WHERE export_uid = $1',
        [exportUid]
    );
    if (rows.length === 0) return null;
    if (rows[0].status === 'ready') return null;   // reintento de algo ya hecho

    await db.query(
        `UPDATE report_exports SET status = 'processing' WHERE export_uid = $1`,
        [exportUid]
    );

    try {
        const archivo = await generarArchivo({ exportUid, formato, filtros });
        guardarEnDisco(archivo.fileName, archivo.buffer);
        await marcarListo(exportUid, { fileName: archivo.fileName, filas: archivo.filas });
        return archivo;
    } catch (err) {
        await marcarFallido(exportUid, err.message);
        // Se relanza para que el worker lo reintente con backoff.
        throw err;
    }
}

/**
 * Estado de una exportacion, para que el cliente sepa si ya puede descargar.
 *
 * Criterio tecnico 6: NO devuelve `filters` ni `requested_by`. Esos campos son
 * auditoria interna y no pueden salir en ninguna respuesta de la API.
 */
async function obtenerEstado(exportUid) {
    const { rows } = await db.query(
        `SELECT export_uid, format, status, row_count, created_at, completed_at
           FROM report_exports WHERE export_uid = $1`,
        [exportUid]
    );
    return rows[0] || null;
}

/** Ruta en disco de una exportacion lista, o null. */
async function obtenerRutaDeArchivo(exportUid) {
    const { rows } = await db.query(
        `SELECT file_name, status, format FROM report_exports WHERE export_uid = $1`,
        [exportUid]
    );
    const registro = rows[0];
    if (!registro || registro.status !== 'ready' || !registro.file_name) return null;

    const ruta = path.join(DIR_EXPORTS, registro.file_name);
    return fs.existsSync(ruta) ? { ruta, ...registro } : null;
}

/** Conecta el servicio al bus. */
function registrarHandlers() {
    eventBus.subscribe(EVENTOS.REPORT_EXPORT_REQUESTED, p => procesarExportacion(p));
    console.log('[reportExports.service] handlers registrados');
}

module.exports = {
    LIMITE_SINCRONO,
    DIR_EXPORTS,
    COLUMNAS,
    escaparCSV,
    generarCSV,
    generarPDF,
    generarArchivo,
    solicitarExportacion,
    procesarExportacion,
    obtenerEstado,
    obtenerRutaDeArchivo,
    registrarHandlers
};
