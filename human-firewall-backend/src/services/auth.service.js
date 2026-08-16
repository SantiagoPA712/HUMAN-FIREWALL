const db = require('../config/db');
const { comparePassword } = require('../utils/hash');
const { generateToken } = require('../utils/token');

exports.login = async (email, password) => {

    const { rows } = await db.query(
        "SELECT * FROM users WHERE email = $1",
        [email]
    );

    if (rows.length === 0) {
        throw new Error("Credenciales inválidas");
    }

    const user = rows[0];


    if (user.lock_until && new Date() < user.lock_until) {
        throw new Error("Cuenta bloqueada temporalmente");
    }

    const valid = await comparePassword(password, user.password);

    if (!valid) {
        await db.query(
            "UPDATE users SET failed_attempts = COALESCE(failed_attempts, 0) + 1 WHERE id = $1",
            [user.id]
        );

        throw new Error("Credenciales inválidas");
    }

    // reset intentos
    await db.query(
        "UPDATE users SET failed_attempts = 0 WHERE id = $1",
        [user.id]
    );

    return generateToken({
        id: user.id,
        role: user.role
    });
};

const { hashPassword } = require('../utils/hash');

exports.register = async (email, password) => {
    // 1. Verificar si el correo ya existe
    const { rows: existingUser } = await db.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
    );

    if (existingUser.length > 0) {
        throw new Error("El correo ya está en uso");
    }

    // 2. Hash de contraseña
    const hashedPassword = await hashPassword(password);

    // 3. Inserción bloqueada en Rol 'employee' (Usuario base que juega)
    const { rows: newUser } = await db.query(
        "INSERT INTO users (email, password, role) VALUES ($1, $2, 'employee') RETURNING id, role",
        [email, hashedPassword]
    );

    // 4. Iniciar sesión automáticamente
    return generateToken({
        id: newUser[0].id,
        role: newUser[0].role
    });
};