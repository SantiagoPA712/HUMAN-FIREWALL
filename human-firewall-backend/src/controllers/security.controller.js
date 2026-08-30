/**
 * Panel de seguridad: anomalias y auditoria.
 *
 * Igual que en reportes, en este archivo NO hay ninguna verificacion de rol.
 * Es lo que pide el criterio tecnico 3: "debo verificar que el claim role del
 * JWT sea security o admin (...) sin ejecutar ninguna consulta". Si el chequeo
 * viviera aca ya estariamos dentro del controlador, y cualquier consulta
 * agregada mas arriba por distraccion se ejecutaria antes de rechazar.
 *
 * El control esta en la definicion de la ruta:
 *   verifyToken() -> requireRoles(['security','admin'])
 */

const anomaliesService = require('../services/anomalies.service');
const auditService = require('../services/audit.service');

/** Convierte a entero positivo, o null. */
const entero = (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
};

const paginacion = (query) => ({
    page: Math.max(1, Number.parseInt(query.page, 10) || 1),
    pageSize: Math.min(100, Math.max(1, Number.parseInt(query.page_size, 10) || 25))
});

/**
 * GET /api/gamification/security/anomalies
 * Query: status, severity, user_id, page, page_size
 */
exports.listAnomalies = async (req, res) => {
    try {
        const { status, severity } = req.query;

        if (status && !anomaliesService.ESTADOS.includes(status)) {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{
                    campo: 'status',
                    detalle: `Estado invalido: "${status}". Validos: ${anomaliesService.ESTADOS.join(', ')}.`
                }]
            });
        }

        const resultado = await anomaliesService.listarAnomalias({
            status: status || null,
            severity: severity || null,
            userId: entero(req.query.user_id),
            ...paginacion(req.query)
        });

        res.status(200).json(resultado);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * GET /api/gamification/security/anomalies/:id
 * Detalle con la linea de tiempo del usuario involucrado.
 */
exports.getAnomaly = async (req, res) => {
    try {
        const id = entero(req.params.id);
        if (!id) return res.status(400).json({ msg: 'Id de anomalia invalido' });

        const anomalia = await anomaliesService.obtenerAnomalia(id);
        if (!anomalia) return res.status(404).json({ msg: 'Anomalia no encontrada' });

        res.status(200).json(anomalia);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * PATCH /api/gamification/security/anomalies/:id/status
 *
 * Criterio tecnico 5: valida el estado y deja traza de quien lo cambio y
 * cuando, sin sobrescribir el anterior.
 */
exports.updateAnomalyStatus = async (req, res) => {
    try {
        const id = entero(req.params.id);
        if (!id) return res.status(400).json({ msg: 'Id de anomalia invalido' });

        const { status, note } = req.body;
        if (!status) {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{ campo: 'status', detalle: 'El nuevo estado es obligatorio.' }]
            });
        }

        const resultado = await anomaliesService.cambiarEstado({
            anomalyId: id,
            nuevoEstado: status,
            userId: req.user.id,
            nota: note || null
        });

        if (!resultado) return res.status(404).json({ msg: 'Anomalia no encontrada' });

        res.status(200).json({
            msg: 'Estado actualizado',
            anomalia: resultado
        });

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
 * GET /api/gamification/security/audit
 * Query: actor_id, target_user_id, change_type, page, page_size
 */
exports.listAuditLog = async (req, res) => {
    try {
        const resultado = await auditService.listar({
            actorId: entero(req.query.actor_id),
            targetUserId: entero(req.query.target_user_id),
            changeType: req.query.change_type || null,
            ...paginacion(req.query)
        });
        res.status(200).json(resultado);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/** GET /api/gamification/security/rules — umbrales vigentes. */
exports.getAnomalyRules = async (req, res) => {
    try {
        res.status(200).json(await anomaliesService.obtenerReglas());
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * PATCH /api/gamification/users/:id/adjust
 *
 * Ajuste manual de puntos, nivel o insignias.
 *
 * Criterio tecnico 4: `reason` es obligatorio; sin el se responde 400 y NO se
 * ejecuta el ajuste. Por eso la validacion va antes de cualquier llamada al
 * servicio: si estuviera despues, un ajuste sin motivo ya se habria aplicado
 * cuando el 400 llegara al cliente.
 */
exports.adjustUser = async (req, res) => {
    try {
        const targetUserId = entero(req.params.id);
        if (!targetUserId) return res.status(400).json({ msg: 'Id de usuario invalido' });

        const { change_type, value, reason } = req.body;
        const errores = [];

        if (!reason || String(reason).trim() === '') {
            errores.push({
                campo: 'reason',
                detalle: 'El motivo es obligatorio: todo ajuste manual queda auditado y sin justificacion no se ejecuta.'
            });
        }
        if (!change_type) {
            errores.push({ campo: 'change_type', detalle: `Obligatorio. Validos: ${auditService.TIPOS.join(', ')}.` });
        }
        if (value === undefined || value === null || value === '') {
            errores.push({ campo: 'value', detalle: 'El valor del ajuste es obligatorio.' });
        }

        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Parametros invalidos', errores });
        }

        const resultado = await auditService.aplicarAjuste({
            actorId: req.user.id,
            targetUserId,
            changeType: change_type,
            valor: value,
            reason: String(reason).trim()
        });

        res.status(200).json({
            msg: 'Ajuste aplicado y auditado',
            ...resultado
        });

    } catch (error) {
        if (error.campo) {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{ campo: error.campo, detalle: error.message }]
            });
        }
        // FK violada = el usuario objetivo no existe.
        if (error.code === '23503') {
            return res.status(404).json({ msg: 'Usuario no encontrado' });
        }
        res.status(500).json({ msg: error.message });
    }
};
