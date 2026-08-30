/**
 * Auditoria de ajustes manuales.
 *
 * HU: deteccion de abuso del sistema de puntos.
 * Criterio de aceptacion 2 y criterio tecnico 4: todo ajuste manual sobre
 * puntos, niveles o insignias queda registrado con responsable, fecha y
 * motivo, en un registro que no se puede editar ni eliminar.
 *
 * ---------------------------------------------------------------------
 * Como se ajusta cada cosa, y por que asi
 * ---------------------------------------------------------------------
 * puntos    -> se inserta un movimiento en points_ledger con source_type
 *              'manual'. NO se toca users.total_points: esa columna es cache
 *              del historial, y escribirla a mano la desincronizaria. El
 *              propio registrarMovimiento la recalcula.
 *
 * nivel     -> el nivel es DERIVADO de los puntos (ver levels.service). No
 *              existe una columna que "poner" en 4. Asi que ajustar el nivel
 *              se traduce a la unica operacion que puede producirlo: otorgar
 *              los puntos que faltan para el umbral de ese nivel.
 *
 *              La alternativa era escribir users.level directamente, pero eso
 *              dura hasta la siguiente asignacion de puntos, que lo recalcula
 *              y lo pisa. Un ajuste que se deshace solo no es un ajuste.
 *
 * insignia  -> se otorga por el mismo camino que el motor automatico, para que
 *              quede con snapshot y sin duplicados. Quitar una insignia NO es
 *              posible: user_rewards es INSERT-only por diseno (la migracion
 *              007 lo impone con un trigger), asi que se rechaza con un
 *              mensaje que lo explica en vez de fallar con un error de base.
 */

const db = require('../config/db');
const pointsService = require('./points.service');
const levelsService = require('./levels.service');
const rewardsService = require('./rewards.service');

const TIPOS = ['points', 'level', 'badge'];

/**
 * Escribe una entrada de auditoria.
 *
 * @param {object} datos
 * @param {number} datos.actorId       quien ejecuta
 * @param {number} [datos.targetUserId] sobre quien
 * @param {string} datos.changeType    points | level | badge | anomaly_status
 * @param {*} [datos.previousValue]
 * @param {*} [datos.newValue]
 * @param {string} datos.reason        obligatorio
 * @param {object} [client]            para participar de una transaccion ajena
 */
async function registrar({ actorId, targetUserId = null, changeType,
                           previousValue = null, newValue = null, reason }, client = db) {
    const { rows } = await client.query(
        `INSERT INTO audit_log
            (actor_id, target_user_id, change_type, previous_value, new_value, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, actor_id, target_user_id, change_type, reason, created_at`,
        [actorId, targetUserId, changeType,
         previousValue === null ? null : JSON.stringify(previousValue),
         newValue === null ? null : JSON.stringify(newValue),
         reason]
    );
    return rows[0];
}

/** Estado actual del usuario, para dejarlo como previous_value. */
async function fotoActual(userId) {
    const [puntos, nivel, insignias] = await Promise.all([
        levelsService.obtenerPuntos(userId),
        levelsService.obtenerNivelDeUsuario(userId),
        db.query('SELECT COUNT(*)::int AS n FROM user_rewards WHERE user_id = $1', [userId])
    ]);

    return {
        puntos,
        nivel: nivel.nivel_actual,
        nivel_nombre: nivel.nombre,
        insignias: insignias.rows[0].n
    };
}

/**
 * Aplica un ajuste manual y lo audita, en ese orden y de forma atomica desde
 * el punto de vista de quien lo pide: si el ajuste falla, no queda auditoria
 * de un cambio que no ocurrio; si la auditoria falla, se propaga el error.
 *
 * @returns {Promise<{aplicado: object, auditoria: object, estado_previo: object, estado_nuevo: object}>}
 */
async function aplicarAjuste({ actorId, targetUserId, changeType, valor, reason }) {
    if (!TIPOS.includes(changeType)) {
        const error = new Error(`Tipo de ajuste invalido: "${changeType}". Validos: ${TIPOS.join(', ')}.`);
        error.campo = 'change_type';
        throw error;
    }

    const previo = await fotoActual(targetUserId);
    let aplicado = null;

    if (changeType === 'points') {
        const puntos = Number(valor);
        if (!Number.isInteger(puntos) || puntos === 0) {
            const error = new Error('El ajuste de puntos debe ser un entero distinto de cero (puede ser negativo).');
            error.campo = 'value';
            throw error;
        }

        // idempotencyKey unica por ajuste: dos ajustes manuales identicos son
        // dos hechos distintos, no un reintento. Se usa el reloj para
        // diferenciarlos.
        aplicado = await pointsService.registrarMovimiento({
            userId: targetUserId,
            sourceType: 'manual',
            sourceId: `ajuste:${actorId}`,
            points: puntos,
            ruleCode: 'manual',
            idempotencyKey: `manual:${targetUserId}:${actorId}:${Date.now()}`
        });

    } else if (changeType === 'level') {
        const nivelObjetivo = Number(valor);
        const escalera = await levelsService.obtenerEscalera();
        const destino = escalera.find(n => n.level === nivelObjetivo);

        if (!destino) {
            const error = new Error(
                `El nivel ${valor} no existe. Niveles disponibles: ${escalera.map(n => n.level).join(', ')}.`
            );
            error.campo = 'value';
            throw error;
        }

        // El nivel se alcanza otorgando los puntos que faltan; ver la nota de
        // cabecera sobre por que no se escribe users.level.
        const faltantes = destino.min_points - previo.puntos;
        if (faltantes <= 0) {
            const error = new Error(
                `El usuario ya tiene ${previo.puntos} puntos, suficientes para el nivel ${nivelObjetivo}. ` +
                `Bajar de nivel exigiria quitarle puntos: hacelo con un ajuste de tipo "points" y valor negativo.`
            );
            error.campo = 'value';
            throw error;
        }

        aplicado = await pointsService.registrarMovimiento({
            userId: targetUserId,
            sourceType: 'manual',
            sourceId: `nivel:${nivelObjetivo}`,
            points: faltantes,
            ruleCode: 'manual',
            idempotencyKey: `manual:nivel:${targetUserId}:${actorId}:${Date.now()}`
        });

    } else if (changeType === 'badge') {
        const rewardId = Number(valor);
        const { rows } = await db.query('SELECT * FROM rewards_catalog WHERE id = $1', [rewardId]);
        if (rows.length === 0) {
            const error = new Error(`No existe ninguna recompensa con id ${valor}.`);
            error.campo = 'value';
            throw error;
        }

        aplicado = await rewardsService.otorgarRecompensa({
            recompensa: rows[0],
            userId: targetUserId,
            sourceType: 'manual',
            sourceId: actorId,
            valorAlcanzado: null
        });

        if (!aplicado) {
            const error = new Error('El usuario ya tiene esa insignia.');
            error.campo = 'value';
            throw error;
        }
    }

    const nuevo = await fotoActual(targetUserId);

    const auditoria = await registrar({
        actorId,
        targetUserId,
        changeType,
        previousValue: previo,
        newValue: nuevo,
        reason
    });

    console.log(
        `[auditoria] ajuste ${changeType} actor=${actorId} objetivo=${targetUserId} ` +
        `motivo="${reason}" en=${auditoria.created_at.toISOString()}`
    );

    return { aplicado, auditoria, estado_previo: previo, estado_nuevo: nuevo };
}

/**
 * Log de auditoria con filtros (mockup 3: "filtros por actor y tipo de
 * cambio").
 */
async function listar({ actorId = null, targetUserId = null, changeType = null,
                        page = 1, pageSize = 25 } = {}) {
    const condiciones = [];
    const params = [];

    if (actorId)      { params.push(actorId);      condiciones.push(`l.actor_id = $${params.length}`); }
    if (targetUserId) { params.push(targetUserId); condiciones.push(`l.target_user_id = $${params.length}`); }
    if (changeType)   { params.push(changeType);   condiciones.push(`l.change_type = $${params.length}`); }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows: totales } = await db.query(
        `SELECT COUNT(*)::int AS total FROM audit_log l ${where}`, params
    );

    const offset = (page - 1) * pageSize;
    const { rows } = await db.query(
        `SELECT l.id, l.change_type, l.previous_value, l.new_value, l.reason, l.created_at,
                l.actor_id,  a.email AS actor_email,
                l.target_user_id, t.email AS target_email
           FROM audit_log l
           JOIN users a ON a.id = l.actor_id
           LEFT JOIN users t ON t.id = l.target_user_id
           ${where}
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset]
    );

    return {
        paginacion: {
            page, page_size: pageSize, total: totales[0].total,
            total_paginas: Math.max(1, Math.ceil(totales[0].total / pageSize))
        },
        resultados: rows
    };
}

module.exports = { TIPOS, registrar, fotoActual, aplicarAjuste, listar };
