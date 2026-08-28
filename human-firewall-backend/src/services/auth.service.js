const db = require('../config/db');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');
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

    // 3. Insercion bloqueada en Rol 'employee' (Usuario base que juega)
    //
    // El INSERT y el evento van en la MISMA transaccion. Si se publicara
    // despues del commit y el proceso se cayera en el medio, quedaria un
    // usuario creado que nunca genero su user.registered: sin correo de
    // bienvenida y sin ninguna forma de detectarlo. Encolado dentro de la
    // transaccion, el evento existe si y solo si el usuario existe.
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: newUser } = await client.query(
            "INSERT INTO users (email, password, role) VALUES ($1, $2, 'employee') RETURNING id, role, email",
            [email, hashedPassword]
        );

        await eventBus.publish(EVENTOS.USER_REGISTERED, {
            userId: newUser[0].id,
            email: newUser[0].email,
            role: newUser[0].role,
            provider: 'local'
        }, client);

        await client.query('COMMIT');

        // 4. Iniciar sesion automaticamente
        return generateToken({
            id: newUser[0].id,
            role: newUser[0].role
        });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
};