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

const repo = require('../infrastructure/persistence/auditoria.repositorio');
const { conCuentas } = require('./cuentas');
// Los puntos, niveles e insignias son de gamificacion: este servicio los
// AUDITA y aplica los ajustes manuales por el contrato de gamificacion, sin
// tocar sus tablas.
const gamificacion = require('../infrastructure/client/gamificacion.cliente');

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
 * @param {object} [tx]                para participar de una transaccion ajena
 */
async function registrar({ actorId, targetUserId = null, changeType,
                           previousValue = null, newValue = null, reason }, tx = null) {
    return repo.insertar({ actorId, targetUserId, changeType, previousValue, newValue, reason }, tx);
}

/** Estado actual del usuario, para dejarlo como previous_value. */
async function fotoActual(userId) {
    const [puntos, nivel, insignias] = await Promise.all([
        gamificacion.obtenerPuntos(userId),
        gamificacion.obtenerNivelDeUsuario(userId),
        gamificacion.contarRecompensasDe(userId)
    ]);

    return {
        puntos,
        nivel: nivel.nivel_actual,
        nivel_nombre: nivel.nombre,
        insignias
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
        aplicado = await gamificacion.registrarMovimiento({
            userId: targetUserId,
            sourceType: 'manual',
            sourceId: `ajuste:${actorId}`,
            points: puntos,
            ruleCode: 'manual',
            idempotencyKey: `manual:${targetUserId}:${actorId}:${Date.now()}`
        });

    } else if (changeType === 'level') {
        const nivelObjetivo = Number(valor);
        const escalera = await gamificacion.obtenerEscalera();
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

        aplicado = await gamificacion.registrarMovimiento({
            userId: targetUserId,
            sourceType: 'manual',
            sourceId: `nivel:${nivelObjetivo}`,
            points: faltantes,
            ruleCode: 'manual',
            idempotencyKey: `manual:nivel:${targetUserId}:${actorId}:${Date.now()}`
        });

    } else if (changeType === 'badge') {
        const rewardId = Number(valor);
        const recompensa = await gamificacion.buscarRecompensa(rewardId);
        if (!recompensa) {
            const error = new Error(`No existe ninguna recompensa con id ${valor}.`);
            error.campo = 'value';
            throw error;
        }

        aplicado = await gamificacion.otorgarRecompensa({
            recompensa,
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
    const filtros = { actorId, targetUserId, changeType };
    const total = await repo.contar(filtros);
    const rows = await conCuentas(
        await repo.pagina(filtros, { limit: pageSize, offset: (page - 1) * pageSize }),
        [
            { campoId: 'actor_id', correo: 'actor_email', obligatoria: true },
            { campoId: 'target_user_id', correo: 'target_email' }
        ]
    );

    return {
        paginacion: {
            page, page_size: pageSize, total,
            total_paginas: Math.max(1, Math.ceil(total / pageSize))
        },
        resultados: rows
    };
}

module.exports = { TIPOS, registrar, fotoActual, aplicarAjuste, listar };
