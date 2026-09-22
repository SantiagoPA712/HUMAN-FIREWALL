/**
 * Consulta de los logs de auditoria (data.logs).
 *
 * Igual que reportes y seguridad: en este archivo NO hay ninguna
 * verificacion de rol. Criterio tecnico 3: "esta validacion debe ejecutarse
 * en el middleware antes de llegar al controlador", y el 403 debe salir "sin
 * ejecutar ninguna consulta a base de datos". Ver routes/logs.routes.js.
 */

const dataLogs = require('../services/dataLogs.service');

/** Respuesta 400 con el detalle por campo, mismo formato que el resto de la API. */
const invalidos = (res, errores) =>
    res.status(400).json({ msg: 'Parametros invalidos', errores });

/**
 * GET /api/logs
 * Query: from, to, user_id, module, action_type, resource_type, order, page, page_size
 *
 * Criterio de aceptacion 2: sin resultados responde 200 con una lista vacia,
 * no un error. El "estado vacio" lo dibuja la pantalla.
 */
exports.listLogs = async (req, res) => {
    try {
        const { errores, filtros } = dataLogs.validarFiltros(req.query);
        if (errores.length > 0) return invalidos(res, errores);

        res.status(200).json(await dataLogs.listar(filtros));
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/logs/filtros
 * Opciones para los desplegables: modulos, tipos de accion y usuarios con
 * acciones registradas.
 */
exports.getFilterOptions = async (req, res) => {
    try {
        res.status(200).json(await dataLogs.opcionesDeFiltro());
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/logs/export
 * Mismos parametros que GET /api/logs (la paginacion se ignora: el archivo
 * trae todas las paginas).
 *
 * Criterio de aceptacion 4: el archivo refleja exactamente los filtros de la
 * pantalla, porque pasa por la misma validacion y la misma consulta.
 *
 * La exportacion es en si misma una accion critica (criterio tecnico 1:
 * "exportaciones"), asi que queda registrada con los filtros que se usaron.
 */
exports.exportLogs = async (req, res) => {
    try {
        const { errores, filtros } = dataLogs.validarFiltros(req.query);
        if (errores.length > 0) return invalidos(res, errores);

        const archivo = await dataLogs.exportarCSV(filtros);

        dataLogs.registrar({
            req,
            accion: dataLogs.ACCIONES.EXPORT,
            modulo: dataLogs.MODULOS.LOGS,
            recurso: 'audit_logs',
            despues: {
                formato: 'csv',
                filtros: dataLogs.filtrosComoTexto(filtros),
                registros: archivo.filas
            }
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${archivo.fileName}"`);
        // Sin esto el navegador no deja leer el nombre del archivo cuando la
        // descarga se hace con axios (la pantalla necesita el token en el
        // encabezado, asi que no puede usar un enlace directo).
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Total-Rows');
        res.setHeader('X-Total-Rows', String(archivo.filas));
        return res.status(200).send(archivo.buffer);

    } catch (error) {
        if (error.campo) {
            return invalidos(res, [{ campo: error.campo, detalle: error.message }]);
        }
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/logs/:id
 * Detalle completo: valores anterior y nuevo, IP y trace_id (criterio de
 * aceptacion 3).
 */
exports.getLog = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0 || String(id) !== String(req.params.id)) {
            return invalidos(res, [{ campo: 'id', detalle: 'Id de log invalido.' }]);
        }

        const log = await dataLogs.obtenerDetalle(id);
        if (!log) return res.status(404).json({ msg: `No existe el log ${id}` });

        res.status(200).json(log);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * PUT / PATCH / DELETE / POST sobre /api/logs
 *
 * Criterio tecnico 4: "rechazar la operacion a nivel de aplicacion". Los
 * logs los escribe solo el sistema y nadie los modifica. Se responde 405 con
 * el motivo en vez de dejar caer la peticion al 404 generico: quien lo
 * intenta tiene que entender que no es que la ruta no exista, es que la
 * operacion esta prohibida.
 */
exports.methodNotAllowed = (req, res) => {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
        msg: 'Los logs de auditoria son inmutables: no se crean, editan ni eliminan por la API. ' +
             'Solo la politica de retencion automatica puede eliminarlos.'
    });
};
