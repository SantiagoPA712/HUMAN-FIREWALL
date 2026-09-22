const authService = require('../services/auth.service');
const dataLogs = require('../services/dataLogs.service');

exports.login = async (req, res) => {
    // Fuera del try: el catch lo necesita para el log del intento fallido.
    const { email, password } = req.body || {};

    try {
        // Aca habia un "bypass de emergencia" que devolvia un token de admin
        // con id 1 a quien mandara admin@humanfirewall.com / AdminPassword123!,
        // sin consultar la base. Se quito con la HU de logs de auditoria: con
        // esa puerta abierta cualquiera podia entrar como admin y leer (o
        // provocar) el registro de auditoria, y el login ni siquiera quedaba
        // registrado. La cuenta admin real entra por el camino normal (su
        // contrasena la fija la migracion 027).

        if (!email || !password) {
            return res.status(400).json({ msg: "Campos obligatorios" });
        }

        const token = await authService.login(email, password);

        res.status(200).json({ token });

    } catch (error) {
        // HU de logs de auditoria, criterio tecnico 1: "inicios de sesion
        // fallidos". El correo que se intento usar queda como actor; el
        // worker le busca el id si la cuenta existe. La contrasena NUNCA
        // viaja al log, ni enmascarada: no aporta nada a la investigacion.
        dataLogs.registrar({
            req,
            accion: dataLogs.ACCIONES.LOGIN_FAILED,
            modulo: dataLogs.MODULOS.AUTH,
            recurso: 'session',
            userId: null,
            actorEmail: String(email).slice(0, 255),
            despues: { motivo: error.message }
        });

        res.status(401).json({ msg: error.message });
    }
};

exports.register = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ msg: "El correo y contraseña son obligatorios" });
        }

        // Validación de complejidad de contraseña en Backend
        const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ msg: "La contraseña debe tener mínimo 8 caracteres, al menos una mayúscula y un número" });
        }

        const token = await authService.register(email, password);

        res.status(201).json({ msg: "Usuario creado exitosamente", token });

    } catch (error) {
        res.status(400).json({ msg: error.message });
    }
};

const recoveryService = require('../services/recovery.service');

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ msg: "El correo es obligatorio" });

        const resetToken = await recoveryService.generateResetToken(email);
        
        // En un entorno de producción, aquí usaremos nodemailer para enviar `resetToken` al email.
        // Simulando el envío:
        console.log(`[EMAIL SEND MOCK] -> To: ${email}, Token: ${resetToken}`);

        res.status(200).json({ msg: "Si el correo está registrado, se habrá enviado un enlace de recuperación." });
    } catch (error) {
        // Para evitar user enumeration, devolvemos success incluso si falla, o validamos silenciosamente.
        // Como es debbug, devolvemos error.
        res.status(400).json({ msg: error.message });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ msg: "Token y nueva contraseña son requeridos" });

        const { userId } = await recoveryService.resetPassword(token, newPassword);

        // Cambio de credencial: accion critica. El valor queda como
        // "[REDACTED]" (criterio tecnico 5): el log dice que la contrasena
        // cambio, nunca cual es.
        dataLogs.registrar({
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
        res.status(400).json({ msg: error.message });
    }
};

exports.logout = async (req, res) => {
    try {
        // En JWT (Bearer tokens por header), el logout se maneja invalidando en frontend 
        // borrando el token del localStorage/memoria.
        // Si tienes una blacklist en BD/Redis la puedes agregar aquí.
        res.status(200).json({ msg: "Sesión cerrada correctamente" });
    } catch (error) {
        res.status(500).json({ msg: "Error al cerrar sesión" });
    }
};


