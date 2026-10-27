/**
 * Casos de uso de cuentas: alta por un admin, listado, cambio de rol o
 * estado, baja logica y perfil propio.
 *
 * Capa Application / Service: coordina. El SQL esta en
 * infrastructure/persistence/usuarios.repositorio.js y las reglas del perfil
 * en domain/usuario.js.
 */

const { conTransaccion } = require('../infrastructure/persistence/conexion');
const { hashPassword } = require('../../../compartido/utils/hash');
const { cambiosDePerfil } = require('../domain/usuario');
const usuarios = require('../infrastructure/persistence/usuarios.repositorio');

exports.createUser = async (data) => {
    const passwordHash = await hashPassword(data.password);
    return usuarios.insertar({ email: data.email, passwordHash, role: data.role || 'employee' });
};

exports.getUsers = () => usuarios.listar();

/** { id, role, is_active } antes de un cambio, o null si no existe. */
exports.getEstado = (userId) => usuarios.estadoActual(userId);

/** Cambia rol y/o estado. Devuelve como quedo. */
exports.updateUser = (userId, cambios) => usuarios.actualizar(userId, cambios);

/** Baja logica. Devuelve { estaba_activo } o null si no existe. */
exports.deactivateUser = (userId) => usuarios.desactivar(userId);

/**
 * Lo que el empleado ve de su propia cuenta. El rol, el equipo y la fecha de
 * alta se muestran pero no se editan: ver CAMPOS_EDITABLES_PERFIL en
 * domain/usuario.js.
 */
exports.getProfile = (userId) => usuarios.leerPerfil(userId);

/** Senal interna para cortar la transaccion sin escribir. */
class SinEscribir {
    constructor(resultado) { this.resultado = resultado; }
}

/**
 * Actualiza los campos editables del perfil propio (HU de perfil editable).
 *
 * Recibe los valores ya validados y normalizados por el dominio. Lee la fila
 * con FOR UPDATE, compara y escribe solo lo que cambio, todo en una
 * transaccion (criterio tecnico 10): si el UPDATE falla no queda nada a
 * medias, y dos guardados simultaneos no comparan contra el mismo "antes".
 *
 * Si nada cambio no se escribe (criterio de aceptacion 5): ni UPDATE ni
 * updated_at nuevo.
 *
 * @returns {Promise<null | { antes, perfil, cambios }>} null si el usuario no existe
 */
exports.updateProfile = async (userId, valores) => {
    try {
        return await conTransaccion(async (tx) => {
            const antes = await usuarios.leerPerfil(userId, { bloquear: true }, tx);
            if (!antes) throw new SinEscribir(null);

            const cambios = cambiosDePerfil(antes, valores);
            if (Object.keys(cambios).length === 0) throw new SinEscribir({ antes, perfil: antes, cambios });

            await usuarios.actualizarPerfil(userId, cambios, tx);
            const perfil = await usuarios.leerPerfil(userId, {}, tx);
            return { antes, perfil, cambios };
        });
    } catch (e) {
        // Sin cambios o sin usuario: ROLLBACK (no se escribio nada) y se
        // devuelve el resultado igual.
        if (e instanceof SinEscribir) return e.resultado;
        throw e;
    }
};
