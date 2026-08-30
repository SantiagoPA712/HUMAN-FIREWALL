/**
 * Reportes de desempeno para RH.
 *
 * Nota sobre el control de acceso: en este archivo NO hay ninguna
 * verificacion de rol. Eso es intencional y es lo que pide el criterio
 * tecnico 1 de la HU: "esta validacion debe ejecutarse en el middleware antes
 * de llegar al controlador", y ademas "sin ejecutar ninguna consulta a base de
 * datos" cuando el rol no corresponde.
 *
 * Si el chequeo viviera aca, el 403 seguiria funcionando pero ya estariamos
 * dentro del controlador; cualquier consulta agregada mas arriba por
 * distraccion se ejecutaria antes de rechazar. Ver report.routes en
 * gamification.routes.js: verifyToken() -> requireRoles(['rh','admin']).
 */

const reportsService = require('../services/reports.service');
const exportsService = require('../services/reportExports.service');

/**
 * GET /api/gamification/reports/performance
 *
 * Query: from, to (ISO 8601), team_id, course_id, page, page_size
 */
exports.getPerformanceReport = async (req, res) => {
    try {
        // Criterio tecnico 2: validar ANTES de consultar. Si algo esta mal se
        // responde 400 con el campo concreto y no se toca la tabla de datos.
        const { errores, filtros } = await reportsService.validarFiltros(req.query);

        if (errores.length > 0) {
            return res.status(400).json({
                msg: 'Parametros de filtrado invalidos',
                errores
            });
        }

        const paginacion = reportsService.normalizarPaginacion(req.query);
        const reporte = await reportsService.obtenerReporteDesempeno(filtros, paginacion);

        // Criterio de aceptacion 2: sin datos es 200 con estado vacio, no un
        // error. El campo `vacio` le ahorra al frontend decidirlo por su cuenta.
        res.status(200).json(reporte);

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/reports/filters
 * Equipos y cursos existentes, para poblar el panel de filtros.
 */
exports.getReportFilters = async (req, res) => {
    try {
        res.status(200).json(await reportsService.obtenerOpcionesDeFiltro());
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * POST /api/gamification/reports/performance/export
 *
 * Body/query: format (csv|pdf) + los mismos filtros que el reporte.
 *
 * Criterio de aceptacion 3: el archivo refleja exactamente los filtros de la
 * pantalla. Por eso la exportacion recibe los mismos parametros y los vuelve a
 * validar, en lugar de confiar en lo que el cliente diga que vio.
 *
 * Criterio tecnico 5: por debajo del umbral se genera y devuelve el archivo;
 * por encima se encola y se responde 202 con el export_id.
 */
exports.exportPerformanceReport = async (req, res) => {
    try {
        // El cliente puede mandar los filtros por query o por body: la
        // pantalla usa POST, pero un enlace de descarga directo es mas comodo
        // con query string.
        const entrada = { ...req.query, ...req.body };

        const { errores, filtros } = await reportsService.validarFiltros(entrada);
        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Parametros de filtrado invalidos', errores });
        }

        const formato = String(entrada.format || 'csv').toLowerCase();

        const resultado = await exportsService.solicitarExportacion({
            userId: req.user.id,
            formato,
            filtros
        });

        if (resultado.modo === 'asincrono') {
            // 202 Accepted: la peticion se acepto pero el archivo todavia no
            // existe. El cliente consulta despues con el export_id.
            return res.status(202).json({
                msg: 'La exportacion supera el umbral y se genera en segundo plano.',
                export_id: resultado.exportUid,
                registros: resultado.total,
                estado: 'pending',
                consultar_en: `/api/gamification/reports/exports/${resultado.exportUid}`
            });
        }

        const { archivo } = resultado;
        res.setHeader('Content-Type', archivo.mime);
        res.setHeader('Content-Disposition', `attachment; filename="${archivo.fileName}"`);
        // Permite que el navegador lea el nombre del archivo cuando la
        // descarga se hace por fetch en vez de con una navegacion.
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        return res.status(200).send(archivo.buffer);

    } catch (error) {
        if (error.campo) {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{ campo: error.campo, detalle: error.message }]
            });
        }
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/reports/exports/:exportId
 *
 * Estado de una exportacion asincrona.
 *
 * Criterio tecnico 6: la respuesta NO incluye los filtros aplicados ni quien
 * la solicito. Esos datos son auditoria interna y no salen por la API; aca
 * solo va lo imprescindible para saber si el archivo ya se puede descargar.
 */
exports.getExportStatus = async (req, res) => {
    try {
        const estado = await exportsService.obtenerEstado(req.params.exportId);
        if (!estado) return res.status(404).json({ msg: 'Exportacion no encontrada' });

        res.status(200).json({
            export_id: estado.export_uid,
            format: estado.format,
            estado: estado.status,
            registros: estado.row_count,
            listo: estado.status === 'ready',
            solicitada_en: estado.created_at,
            completada_en: estado.completed_at
        });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/reports/exports/:exportId/download
 * Descarga el archivo de una exportacion asincrona ya generada.
 */
exports.downloadExport = async (req, res) => {
    try {
        const archivo = await exportsService.obtenerRutaDeArchivo(req.params.exportId);

        if (!archivo) {
            return res.status(404).json({
                msg: 'El archivo no esta disponible. Puede que todavia se este generando o que la exportacion haya fallado.'
            });
        }

        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.download(archivo.ruta, archivo.file_name);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
