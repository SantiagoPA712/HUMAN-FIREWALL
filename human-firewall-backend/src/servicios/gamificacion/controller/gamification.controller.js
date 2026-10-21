/**
 * Controlador HTTP de gamificacion.
 *
 * Capa de presentacion: ya no importa la base de datos. Las consultas que
 * tenia (18) pasaron a infraestructura/gamificacion.repositorio.js, el
 * "usuario existe" lo responde identidad por su contrato, y los registros de
 * auditoria van por el cliente de seguridad.
 *
 * POST /api/gamification/challenge se mudo a evaluaciones
 * (api/desafios.controller.js): registra un intento, y los intentos son de
 * ese servicio. La URL no cambio.
 */

const repo = require('../infrastructure/persistence/gamificacion.repositorio');
const pointsService = require('../application/points.service');
const rewardsService = require('../application/rewards.service');
const levelsService = require('../application/levels.service');
const recommendationsService = require('../application/recommendations.service');
const identidad = require('../infrastructure/client/identidad.cliente');
const seguridad = require('../infrastructure/client/seguridad.cliente');
const { responderError, ErrorHttp } = require('../../../compartido/http/errores');

/** 404 si el usuario de la ruta no existe. */
async function exigirUsuario(userId) {
    if (!(await identidad.usuarioExiste(userId))) throw ErrorHttp.noEncontrado('Usuario no encontrado');
}

exports.getLeaderboard = async (req, res) => {
    try {
        res.status(200).json(await repo.ranking(10));
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.getMyStatus = async (req, res) => {
    try {
        const userId = req.user.id;

        const estado = await repo.estadoDe(userId);
        if (!estado) return res.status(404).json({ msg: "Usuario no encontrado", codigo: 'NO_ENCONTRADO' });

        // Los datos salen del snapshot guardado en user_rewards, no del
        // catalogo: asi la respuesta no cambia si la recompensa se edito o se
        // elimino despues de otorgarse.
        res.status(200).json({
            gamification: estado,
            badges: await repo.insigniasDe(userId)
        });
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.createBadge = async (req, res) => {
    try {
        const {
            name, description, icon_url,
            condition_type = 'points_total',
            threshold,
            points_required,
            is_repeatable = false
        } = req.body;

        if (!name) return res.status(400).json({ msg: "El nombre de la insignia es obligatorio", codigo: 'VALIDACION' });

        // points_required se sigue aceptando por compatibilidad con el cliente
        // viejo, pero internamente ya es un parametro de condicion mas.
        const umbral = threshold != null ? threshold : (points_required || 0);

        const creada = await repo.insertarRecompensa({
            name, description, iconUrl: icon_url, conditionType: condition_type, umbral, isRepeatable: is_repeatable
        });

        // Alta en el catalogo de recompensas: creacion de un recurso que
        // decide quien gana que (HU de logs, criterio tecnico 1).
        seguridad.registrarAccion({
            req,
            accion: seguridad.ACCIONES.CREATE,
            modulo: seguridad.MODULOS.GAMIFICATION,
            recurso: 'reward',
            recursoId: creada.id,
            despues: creada
        });

        res.status(201).json(creada);
    } catch (error) {
        if (error.code === '23514') {
            return res.status(400).json({ msg: "Tipo de condicion no valido", codigo: 'VALIDACION' });
        }
        responderError(req, res, error);
    }
};

/**
 * Asignacion manual de una insignia.
 *
 * Criterio tecnico 4 de la HU de seguridad: "debo auditar todo ajuste manual
 * sobre puntos, niveles o insignias, SIN EXCEPCION". Este endpoint es
 * exactamente eso, asi que tambien exige `reason` y escribe en audit_log.
 *
 * Sin esto quedaba una puerta lateral: el panel de seguridad no podria
 * responder quien otorgo una insignia a mano ni con que justificacion, que es
 * justo lo que la historia viene a cerrar. Un registro de auditoria con un
 * camino que lo evita no es un registro de auditoria.
 */
exports.assignBadge = async (req, res) => {
    try {
        // badge_id se mantiene como alias por compatibilidad.
        const { user_id, reward_id, badge_id, reason } = req.body;
        const recompensaId = reward_id || badge_id;

        if (!user_id || !recompensaId) {
            return res.status(400).json({ msg: "user_id y reward_id son obligatorios", codigo: 'VALIDACION' });
        }

        if (!reason || String(reason).trim() === '') {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{
                    campo: 'reason',
                    detalle: 'El motivo es obligatorio: toda asignacion manual queda auditada.'
                }]
            });
        }

        const recompensa = await repo.buscarRecompensa(recompensaId);
        if (!recompensa) {
            return res.status(404).json({ msg: "Recompensa no encontrada en el catalogo", codigo: 'NO_ENCONTRADO' });
        }

        // Se otorga por el mismo camino que el motor automatico, para que la
        // asignacion manual tambien quede con snapshot y sin duplicados.
        const otorgada = await rewardsService.otorgarRecompensa({
            recompensa,
            userId: user_id,
            sourceType: 'manual',
            sourceId: req.user.id,
            valorAlcanzado: null
        });

        if (!otorgada) {
            return res.status(200).json({ msg: "El usuario ya tiene esta insignia" });
        }

        await seguridad.auditarAjusteManual({
            actorId: req.user.id,
            targetUserId: user_id,
            changeType: 'badge',
            previousValue: null,
            newValue: { reward_id: recompensa.id, reward_name: recompensa.name },
            reason: String(reason).trim()
        });

        // audit_log es el registro del panel de seguridad; data.logs es el
        // registro central. El ajuste manual va a los dos.
        seguridad.registrarAccion({
            req,
            accion: seguridad.ACCIONES.MANUAL_ADJUSTMENT,
            modulo: seguridad.MODULOS.GAMIFICATION,
            recurso: 'user',
            recursoId: user_id,
            despues: {
                tipo: 'badge',
                reward_id: recompensa.id,
                reward_name: recompensa.name,
                motivo: String(reason).trim()
            }
        });

        res.status(201).json({ msg: "Insignia asignada exitosamente", data: otorgada });
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/gamification/points/:userId
 *
 * Criterio tecnico 3: retorna el total acumulado y el detalle paginado del
 * historial. El control de acceso (propio usuario, admin o rh) lo aplica el
 * middleware selfOrRoles en la definicion de la ruta.
 *
 * Query params: ?page=1&limit=20
 */
exports.getUserPoints = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

        await exigirUsuario(userId);

        const resultado = await pointsService.obtenerHistorial(userId, { page, limit });
        res.status(200).json(resultado);
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/gamification/points/:userId/rules
 * Reglas de puntuacion vigentes. Sirve para que el frontend muestre cuantos
 * puntos otorga cada accion sin hardcodearlos.
 */
exports.getPointsRules = async (req, res) => {
    try {
        res.status(200).json(await repo.reglasActivas());
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/gamification/rewards/:userId
 *
 * Criterio tecnico 4: recompensas obtenidas por el usuario, con las mismas
 * reglas de acceso por rol que el resto del modulo. El control lo aplica
 * selfOrRoles en la definicion de la ruta.
 *
 * Devuelve tambien las bloqueadas, con el progreso hacia cada una, para la
 * galeria de logros.
 */
exports.getUserRewards = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        await exigirUsuario(userId);

        const resultado = await rewardsService.obtenerRecompensasDeUsuario(userId);
        res.status(200).json(resultado);
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/gamification/level/:userId
 *
 * Criterio tecnico 2: calcula el nivel a partir del total de puntos derivado
 * de points_ledger y devuelve nivel actual, puntos actuales, puntos para el
 * siguiente nivel y porcentaje de avance.
 *
 * Criterio de aceptacion 3 / criterio tecnico 4: el 403 ante el nivel de otro
 * usuario lo aplica selfOrRoles en la definicion de la ruta, igual que en el
 * endpoint de puntos.
 */
exports.getUserLevel = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        await exigirUsuario(userId);

        const resultado = await levelsService.obtenerNivelDeUsuario(userId);
        res.status(200).json(resultado);
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/gamification/performance/:userId
 *
 * Criterio tecnico 1: agrega quiz_attempts y lesson_progress del usuario para
 * armar el resumen de desempeno, las areas de oportunidad y las
 * recomendaciones de refuerzo.
 *
 * Criterio tecnico 3: mismas reglas de acceso que el resto del modulo. El 403
 * lo aplica selfOrRoles en la definicion de la ruta; el servicio, ademas,
 * filtra siempre por el user_id recibido, asi que no hay forma de que se
 * cuelen datos de otro usuario.
 */
exports.getUserPerformance = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        await exigirUsuario(userId);

        const resultado = await recommendationsService.obtenerResumenDesempeno(userId);
        res.status(200).json(resultado);
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/gamification/recommendations/:userId
 *
 * Misma informacion de refuerzo que /performance, pero leida de la
 * proyeccion que mantienen los eventos (user_recommendations) en vez de
 * recalcularla en el request.
 *
 * Los dos endpoints conviven a proposito:
 *   /performance      -> calculo en vivo, siempre exacto, seis consultas.
 *   /recommendations  -> lectura de la proyeccion, una consulta, puede estar
 *                        unos segundos atras si el worker todavia no proceso
 *                        el ultimo evento.
 *
 * Esa diferencia de segundos es justamente lo que se acepta al pasar a
 * eventos: consistencia eventual a cambio de que la accion original responda
 * sin esperar el calculo.
 */
exports.getUserRecommendations = async (req, res) => {
    try {
        const userId = Number.parseInt(req.params.userId, 10);

        await exigirUsuario(userId);

        const proyeccion = await recommendationsService.obtenerRecomendacionesPrecalculadas(userId);
        res.status(200).json(proyeccion);
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/gamification/levels
 * Escalera completa de niveles. Permite mostrar todos los tramos sin
 * hardcodear los umbrales en el frontend.
 */
exports.getLevelsConfig = async (req, res) => {
    try {
        const escalera = await levelsService.obtenerEscalera();
        res.status(200).json(escalera);
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/gamification/rewards
 * Catalogo completo de recompensas activas.
 */
exports.getRewardsCatalog = async (req, res) => {
    try {
        res.status(200).json(await repo.catalogoPublico());
    } catch (error) {
        responderError(req, res, error);
    }
};
