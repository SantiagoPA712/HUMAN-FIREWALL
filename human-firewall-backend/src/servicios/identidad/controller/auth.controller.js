/**
 * Controlador HTTP de autenticacion (/api/auth).
 *
 * Capa de presentacion. Los errores de negocio (credenciales invalidas,
 * correo en uso, token vencido) llegan como ErrorHttp desde la capa de
 * aplicacion y se responden con su status. Cualquier otro error sale como
 * 500 generico: antes se devolvia error.message tal cual, y con la base
 * caida eso mostraba el texto interno de PostgreSQL en la pantalla de login.
 */

const authService = require('../application/auth.service');
const recoveryService = require('../application/recovery.service');
const { responderError, ErrorHttp } = require('../../../compartido/http/errores');
const { cumplePolitica, MENSAJE_POLITICA } = require('../domain/usuario');
// data.logs es de seguridad: se llega por su contrato.
const dataLogs = require('../infrastructure/client/seguridad.cliente');

exports.login = async (req, res) => {
    // Fuera del try: el catch lo necesita para el log del intento fallido.
    const { email, password } = req.body || {};

    try {
        if (!email || !password) {
            return res.status(400).json({ msg: "Campos obligatorios", codigo: 'VALIDACION' });
        }

        const token = await authService.login(email, password);
        res.status(200).json({ token });

    } catch (error) {
        // HU de logs de auditoria: "inicios de sesion fallidos". El correo que
        // se intento usar queda como actor; la contrasena NUNCA viaja al log.
        dataLogs.registrarAccion({
            req,
            accion: dataLogs.ACCIONES.LOGIN_FAILED,
            modulo: dataLogs.MODULOS.AUTH,
            recurso: 'session',
            userId: null,
            actorEmail: String(email).slice(0, 255),
            despues: { motivo: error instanceof ErrorHttp ? error.message : 'error interno' }
        });

        responderError(req, res, error);
    }
};

exports.register = async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ msg: "El correo y contraseña son obligatorios", codigo: 'VALIDACION' });
        }
        if (!cumplePolitica(password)) {
            return res.status(400).json({ msg: MENSAJE_POLITICA, codigo: 'VALIDACION' });
        }

        const token = await authService.register(email, password);
        res.status(201).json({ msg: "Usuario creado exitosamente", token });

    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * POST /api/auth/forgot-password
 *
 * Siempre responde lo mismo, exista o no la cuenta. Antes devolvia 400 con
 * "El correo no esta registrado", y eso permitia averiguar que correos
 * tienen cuenta (deuda tecnica #7 del README).
 */
exports.forgotPassword = async (req, res) => {
    const generico = { msg: "Si el correo está registrado, se habrá enviado un enlace de recuperación." };
    try {
        const { email } = req.body || {};
        if (!email) return res.status(400).json({ msg: "El correo es obligatorio", codigo: 'VALIDACION' });

        try {
            const resetToken = await recoveryService.generateResetToken(email);
            // El envio real esta pendiente. En desarrollo se muestra en consola
            // para poder probar el flujo; en produccion nunca se imprime.
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[EMAIL SEND MOCK] -> To: ${email}, Token: ${resetToken}`);
            }
        } catch (error) {
            if (!(error instanceof ErrorHttp && error.status === 404)) throw error;
        }

        res.status(200).json(generico);
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body || {};
        if (!token || !newPassword) {
            return res.status(400).json({ msg: "Token y nueva contraseña son requeridos", codigo: 'VALIDACION' });
        }

        const { userId } = await recoveryService.resetPassword(token, newPassword);

        // Cambio de credencial: accion critica. El valor queda como
        // "[REDACTED]": el log dice que la contrasena cambio, nunca cual es.
        dataLogs.registrarAccion({
            req,
            accion: dataLogs.ACCIONES.PASSWORD_RESET,
            modulo: dataLogs.MODULOS.AUTH,
            recurso: 'user',
            recursoId: userId,
            userId,
            despues: { password: newPassword, via: 'token_de_recuperacion' }
        });

        res.status(200).json({ msg: "Contraseña actualizada exitosamente" });
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * Con JWT por encabezado, cerrar sesion es borrar el token en el cliente.
 * El endpoint existe para que el frontend tenga un punto unico de salida.
 */
exports.logout = async (req, res) => {
    res.status(200).json({ msg: "Sesión cerrada correctamente" });
};
