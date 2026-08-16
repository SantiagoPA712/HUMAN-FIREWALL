const authService = require('../services/auth.service');
const { generateToken } = require('../utils/token');

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // --- BYPASS DE EMERGENCIA POR TIMEOUT DE SUPABASE ---
        if (email === 'admin@humanfirewall.com' && password === 'AdminPassword123!') {
            const token = generateToken({ id: 1, role: 'admin' });
            return res.json({ message: "Mock Login exitoso", token });
        }
        // ----------------------------------------------------

        if (!email || !password) {
            return res.status(400).json({ msg: "Campos obligatorios" });
        }

        const token = await authService.login(email, password);

        res.status(200).json({ token });

    } catch (error) {
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

        await recoveryService.resetPassword(token, newPassword);
        
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


