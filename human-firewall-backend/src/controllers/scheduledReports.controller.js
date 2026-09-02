/**
 * Reportes automaticos periodicos.
 *
 * HU: "quiero generar reportes automaticos de forma periodica para que RH,
 * seguridad y gerencia reciban informacion actualizada sin necesidad de
 * generarla manualmente".
 *
 * Igual que en report.controller: aca NO hay ninguna verificacion de rol. El
 * criterio tecnico 6 pide que el 403 salga "sin persistir ningun cambio", y la
 * unica forma de garantizarlo es cortar antes de entrar al controlador. Ver
 * gamification.routes.js: verifyToken() -> requireRoles(['admin']).
 *
 * Lo que si vive aca es la otra mitad del criterio tecnico 5: que mensaje ve
 * cada quien cuando un reporte falla. El detalle tecnico solo se agrega a la
 * respuesta si quien consulta es administrador; RH, seguridad y gerencia
 * reciben el mensaje generico.
 */

const scheduledReports = require('../services/scheduledReports.service');

/**
 * GET /api/gamification/reports/schedules
 * Programaciones configuradas (panel del mockup 1).
 */
exports.listSchedules = async (req, res) => {
    try {
        res.status(200).json({
            tipos: scheduledReports.TIPOS,
            frecuencias: scheduledReports.FRECUENCIAS,
            formatos: scheduledReports.FORMATOS,
            roles: scheduledReports.ROLES,
            programaciones: await scheduledReports.listarProgramaciones()
        });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * POST /api/gamification/reports/schedules
 *
 * Criterio tecnico 6: si el rol no es admin, el middleware ya respondio 403 y
 * nada de esto corrio.
 */
exports.createSchedule = async (req, res) => {
    try {
        const { errores, valores } = await scheduledReports.validarProgramacion(req.body || {});

        // Se valida ANTES de escribir: una programacion con un equipo
        // inexistente no se guarda a medias para fallar despues, de noche,
        // dentro de un job que nadie esta mirando.
        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Programacion invalida', errores });
        }

        const creada = await scheduledReports.crearProgramacion(valores, req.user.id);
        res.status(201).json(creada);

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * PATCH /api/gamification/reports/schedules/:id
 * Cambia frecuencia, destinatarios, filtros o el estado activo.
 */
exports.updateSchedule = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ msg: 'Id de programacion invalido' });
        }

        const { errores, valores } = await scheduledReports.validarProgramacion(
            req.body || {}, { parcial: true }
        );

        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Programacion invalida', errores });
        }

        if (Object.keys(valores).length === 0) {
            return res.status(400).json({ msg: 'No se envio ningun campo para actualizar' });
        }

        const actualizada = await scheduledReports.actualizarProgramacion(id, valores);
        if (!actualizada) return res.status(404).json({ msg: `No existe la programacion ${id}` });

        res.status(200).json(actualizada);

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/reports/history
 * Historico de reportes generados, con estado y enlace de descarga (mockup 2).
 */
exports.listHistory = async (req, res) => {
    try {
        const scheduleId = req.query.schedule_id
            ? Number.parseInt(req.query.schedule_id, 10)
            : null;

        const limite = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));

        // Criterio tecnico 5: el detalle tecnico del error solo para quien
        // puede actuar sobre el. Los demas ven el mensaje generico que arma el
        // servicio.
        const historial = await scheduledReports.listarHistorico({
            scheduleId,
            limite,
            incluirDetalleTecnico: req.user.role === 'admin'
        });

        res.status(200).json({ total: historial.length, resultados: historial });

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/reports/history/:id/download
 * Descarga el archivo de un reporte generado.
 */
exports.downloadHistoryFile = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ msg: 'Id de reporte invalido' });
        }

        const archivo = await scheduledReports.obtenerArchivo(id);

        if (!archivo) {
            return res.status(404).json({
                msg: 'El archivo no esta disponible. Puede que la generacion haya fallado ' +
                     'o que el archivo se haya retirado por politica de retencion.'
            });
        }

        // Permite que el navegador lea el nombre cuando la descarga se hace
        // por fetch en vez de con una navegacion.
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.download(archivo.ruta, archivo.nombre);

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
