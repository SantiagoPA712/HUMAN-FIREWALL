/**
 * Casos de uso de recuperacion de contrasena: generar el token y
 * restablecer la contrasena, que publica user.password_changed.
 *
 * Capa Application / Service. El SQL esta en
 * infrastructure/persistence/recuperacion.repositorio.js y
 * usuarios.repositorio.js.
 */

const crypto = require('crypto');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { conTransaccion } = require('../infrastructure/persistence/conexion');
const { hashPassword } = require('../../../compartido/utils/hash');
const { ErrorHttp } = require('../../../compartido/http/errores');
const { cumplePolitica, MENSAJE_POLITICA } = require('../domain/usuario');
const config = require('../config/configuracion');
const usuarios = require('../infrastructure/persistence/usuarios.repositorio');
const recuperacion = require('../infrastructure/persistence/recuperacion.repositorio');

exports.generateResetToken = async (email) => {
    const userId = await usuarios.idPorCorreo(email);
    if (!userId) {
        // El controlador NO le muestra este error al cliente (enumeracion de
        // cuentas): responde siempre el mismo mensaje generico.
        throw ErrorHttp.noEncontrado('El correo no está registrado');
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiraEn = new Date(Date.now() + config.minutosDeVigenciaRecuperacion * 60 * 1000);
    await recuperacion.insertarToken({ userId, token: resetToken, expiraEn });

    return resetToken;
};

exports.resetPassword = async (token, newPassword) => {
    const fila = await recuperacion.buscarToken(token);
    if (!fila) throw new ErrorHttp(400, 'Token inválido', { codigo: 'VALIDACION' });

    if (new Date() > new Date(fila.expires_at)) {
        throw new ErrorHttp(400, 'El token ha expirado', { codigo: 'VALIDACION' });
    }
    if (!cumplePolitica(newPassword)) {
        throw new ErrorHttp(400, MENSAJE_POLITICA, { codigo: 'VALIDACION' });
    }

    const passwordHash = await hashPassword(newPassword);

    // El cambio publica user.password_changed (correo CRITICO de seguridad)
    // en la misma transaccion que el UPDATE: si la contrasena cambio, el
    // aviso existe; si el UPDATE se revierte, no sale un aviso falso.
    await conTransaccion(async (tx) => {
        await usuarios.actualizarContrasena(fila.user_id, passwordHash, tx);
        await recuperacion.borrarToken(token, tx);
        await eventBus.publish(EVENTOS.USER_PASSWORD_CHANGED, {
            userId: fila.user_id,
            changedAt: new Date().toISOString()
        }, tx);
    });

    // Devuelve a quien se le cambio la contrasena, para el log de auditoria.
    return { userId: fila.user_id };
};
