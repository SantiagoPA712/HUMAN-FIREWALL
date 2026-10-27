/**
 * Casos de uso de autenticacion: login (con bloqueo por intentos) y registro
 * publico como employee, que publica user.registered.
 *
 * Capa Application / Service: coordina. El SQL esta en
 * infrastructure/persistence/usuarios.repositorio.js y las reglas de la
 * contrasena en domain/usuario.js.
 *
 * Los errores de negocio se lanzan como ErrorHttp: el controlador responde
 * con su status y su mensaje. Cualquier otro error (la base caida, por
 * ejemplo) sale como 500 generico, sin el texto interno.
 */

const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { conTransaccion } = require('../infrastructure/persistence/conexion');
const { comparePassword, hashPassword } = require('../../../compartido/utils/hash');
const { generateToken } = require('../../../compartido/utils/token');
const { ErrorHttp } = require('../../../compartido/http/errores');
const usuarios = require('../infrastructure/persistence/usuarios.repositorio');

const credencialesInvalidas = () =>
    new ErrorHttp(401, 'Credenciales inválidas', { codigo: 'NO_AUTENTICADO' });

exports.login = async (email, password) => {
    const user = await usuarios.buscarPorCorreo(email);
    if (!user) throw credencialesInvalidas();

    if (user.lock_until && new Date() < user.lock_until) {
        throw new ErrorHttp(401, 'Cuenta bloqueada temporalmente', { codigo: 'NO_AUTENTICADO' });
    }

    if (!(await comparePassword(password, user.password))) {
        await usuarios.sumarIntentoFallido(user.id);
        throw credencialesInvalidas();
    }

    await usuarios.reiniciarIntentos(user.id);
    return generateToken({ id: user.id, role: user.role });
};

exports.register = async (email, password) => {
    if (await usuarios.buscarPorCorreo(email)) {
        // 400 y no 409 a proposito: el frontend ya interpreta este 400. Pasar a 409
        // seria un cambio de contrato incompatible (ver docs/contratos/POLITICA.md).
        throw new ErrorHttp(400, 'El correo ya está en uso', { codigo: 'CONFLICTO' });
    }

    const passwordHash = await hashPassword(password);

    // El INSERT y el evento van en la MISMA transaccion: el evento existe si
    // y solo si el usuario existe. Si se publicara despues del commit y el
    // proceso se cayera en el medio, quedaria un usuario sin bienvenida.
    const nuevo = await conTransaccion(async (tx) => {
        const usuario = await usuarios.insertar({ email, passwordHash, role: 'employee' }, tx);
        await eventBus.publish(EVENTOS.USER_REGISTERED, {
            userId: usuario.id,
            email: usuario.email,
            role: usuario.role,
            provider: 'local'
        }, tx);
        return usuario;
    });

    // Inicia sesion automaticamente.
    return generateToken({ id: nuevo.id, role: nuevo.role });
};
