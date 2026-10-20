const db = require('../../../compartido/config/db');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { comparePassword } = require('../../../compartido/utils/hash');
const { generateToken } = require('../../../compartido/utils/token');
const { ErrorHttp } = require('../../../compartido/http/errores');

// Los errores de negocio se lanzan como ErrorHttp: el controlador responde
// con su status y su mensaje. Cualquier otro error (la base caida, por
// ejemplo) sale como 500 generico, sin el texto interno.

exports.login = async (email, password) => {

    const { rows } = await db.query(
        "SELECT * FROM users WHERE email = $1",
        [email]
    );

    if (rows.length === 0) {
        throw new ErrorHttp(401, "Credenciales inválidas", { codigo: 'NO_AUTENTICADO' });
    }

    const user = rows[0];


    if (user.lock_until && new Date() < user.lock_until) {
        throw new ErrorHttp(401, "Cuenta bloqueada temporalmente", { codigo: 'NO_AUTENTICADO' });
    }

    const valid = await comparePassword(password, user.password);

    if (!valid) {
        await db.query(
            "UPDATE users SET failed_attempts = COALESCE(failed_attempts, 0) + 1 WHERE id = $1",
            [user.id]
        );

        throw new ErrorHttp(401, "Credenciales inválidas", { codigo: 'NO_AUTENTICADO' });
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

const { hashPassword } = require('../../../compartido/utils/hash');

exports.register = async (email, password) => {
    // 1. Verificar si el correo ya existe
    const { rows: existingUser } = await db.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
    );

    if (existingUser.length > 0) {
        // 400 y no 409 a proposito: el frontend ya interpreta este 400. Pasar a 409
        // seria un cambio de contrato incompatible (ver docs/contratos/POLITICA.md).
        throw new ErrorHttp(400, "El correo ya está en uso", { codigo: 'CONFLICTO' });
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