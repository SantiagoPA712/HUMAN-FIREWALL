/**
 * Controlador HTTP de usuarios (/api/users).
 *
 * Capa de presentacion: el SQL que tenia paso a
 * infraestructura/usuarios.repositorio.js y los roles e idiomas validos a
 * dominio/usuario.js.
 */

const userService = require('../application/user.service');
const usuarios = require('../infrastructure/persistence/usuarios.repositorio');
const {
    ROLES: ROLES_VALIDOS,
    IDIOMAS: IDIOMAS_VALIDOS,
    catalogoDeIdiomas,
    CAMPOS_EDITABLES_PERFIL,
    camposProtegidos,
    validarPerfil
} = require('../domain/usuario');
const { responderError } = require('../../../compartido/http/errores');
// data.logs es de seguridad: se llega por su contrato.
const dataLogs = require('../infrastructure/client/seguridad.cliente');

exports.create = async (req, res) => {
    try {
        const { role } = req.body || {};
        if (role && !ROLES_VALIDOS.includes(role)) {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{ campo: 'role', detalle: `Rol invalido. Validos: ${ROLES_VALIDOS.join(', ')}.` }]
            });
        }

        const creado = await userService.createUser(req.body);

        // Creacion de un recurso sensible (criterio tecnico 1 de la HU de
        // logs). Se pasa el body tal cual a proposito: trae la contrasena, y
        // el enmascarado del servicio la deja en "[REDACTED]" (criterio 5).
        dataLogs.registrarAccion({
            req,
            accion: dataLogs.ACCIONES.CREATE,
            modulo: dataLogs.MODULOS.USERS,
            recurso: 'user',
            recursoId: creado?.id,
            despues: { ...req.body, role: creado?.role || req.body.role || 'employee' }
        });

        res.status(201).json({ msg: "Usuario creado" });
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.getAll = async (req, res) => {
    try {
        const users = await userService.getUsers();
        res.json(users);
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * PUT /api/users/:id  { role?, is_active? }
 *
 * Cambios con la HU de logs de auditoria:
 *   - el rol se valida ANTES del UPDATE. Antes un rol inexistente llegaba al
 *     CHECK de la base y volvia un 500 con el error crudo de Postgres;
 *   - se lee el estado anterior, porque el log de un cambio de rol sin el
 *     rol que tenia antes no sirve para investigar nada;
 *   - un id que no existe devuelve 404 en lugar de "Usuario actualizado".
 */
exports.updateUser = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ msg: 'Id de usuario invalido' });
        }

        const { role, is_active } = req.body || {};
        const errores = [];

        if (role !== undefined && !ROLES_VALIDOS.includes(role)) {
            errores.push({ campo: 'role', detalle: `Rol invalido. Validos: ${ROLES_VALIDOS.join(', ')}.` });
        }
        if (is_active !== undefined && typeof is_active !== 'boolean') {
            errores.push({ campo: 'is_active', detalle: 'Debe ser true o false.' });
        }
        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Parametros invalidos', errores });
        }

        const antes = await usuarios.estadoActual(id);
        if (!antes) return res.status(404).json({ msg: 'Usuario no encontrado', codigo: 'NO_ENCONTRADO' });

        const cambios = {};
        if (role !== undefined && role !== antes.role) cambios.role = role;
        if (is_active !== undefined && is_active !== antes.is_active) cambios.is_active = is_active;

        // Nada que cambiar: no se escribe ni se registra un "cambio" vacio.
        if (Object.keys(cambios).length === 0) {
            return res.status(200).json({ msg: "Usuario actualizado" });
        }

        const despues = await usuarios.actualizar(id, cambios);

        // Un cambio de rol es su propio tipo de accion (criterio tecnico 1
        // lo nombra aparte): es lo primero que se busca ante una escalada de
        // privilegios. Si en la misma llamada tambien cambio is_active, va en
        // la misma fila.
        const cambioDeRol = despues.role !== antes.role;
        dataLogs.registrarAccion({
            req,
            accion: cambioDeRol ? dataLogs.ACCIONES.ROLE_CHANGE : dataLogs.ACCIONES.UPDATE,
            modulo: dataLogs.MODULOS.USERS,
            recurso: 'user',
            recursoId: id,
            antes: { role: antes.role, is_active: antes.is_active },
            despues: { role: despues.role, is_active: despues.is_active }
        });

        res.status(200).json({ msg: "Usuario actualizado" });
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * DELETE /api/users/:id — baja logica (is_active = false).
 * Se registra como "deactivate" y no como "delete": el usuario sigue en la
 * base, y quien lea el log tiene que saber que se puede revertir.
 */
exports.deactivateUser = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ msg: 'Id de usuario invalido' });
        }

        const previo = await usuarios.desactivar(id);
        if (!previo) return res.status(404).json({ msg: 'Usuario no encontrado', codigo: 'NO_ENCONTRADO' });

        dataLogs.registrarAccion({
            req,
            accion: dataLogs.ACCIONES.DEACTIVATE,
            modulo: dataLogs.MODULOS.USERS,
            recurso: 'user',
            recursoId: id,
            antes: { is_active: previo.estaba_activo },
            despues: { is_active: false }
        });

        res.status(200).json({ msg: "Usuario desactivado" });
    } catch (error) {
        responderError(req, res, error);
    }
};


/**
 * GET /api/users/idiomas
 *
 * Idiomas habilitados en la plataforma y cual es el de por defecto.
 *
 * Criterio de aceptacion 1 de la HU de preferencia de idioma: el empleado
 * tiene que poder VER las opciones disponibles. Sale del dominio y no de una
 * lista escrita en la interfaz para que el criterio tecnico 7 ("aceptar
 * unicamente los idiomas habilitados") se cumpla contra la misma fuente que
 * valida el PATCH: si se agrega un idioma, el selector lo muestra solo.
 *
 * No exige rol: es el catalogo de la plataforma, no datos de nadie. Si exige
 * sesion, porque la pantalla de preferencias ya la tiene.
 */
exports.getIdiomas = async (req, res) => {
    try {
        res.status(200).json(catalogoDeIdiomas());
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * GET /api/users/me
 *
 * El id sale del token, igual que en las notificaciones: nadie consulta el
 * perfil de otro por aca.
 */
exports.getMe = async (req, res) => {
    try {
        const perfil = await userService.getProfile(req.user.id);
        if (!perfil) return res.status(404).json({ msg: 'Usuario no encontrado' });
        res.status(200).json(perfil);
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * PATCH /api/users/me   Body: { full_name?, phone?, language? }
 *
 * HU de perfil editable. Antes solo cambiaba el idioma (HU de notificaciones
 * por correo); ahora es la misma ruta para todo el perfil propio, sin una
 * segunda ruta que haga lo mismo (criterio tecnico 2).
 *
 * El id sale del token, nunca del cuerpo: no hay forma de apuntar a otro
 * usuario (criterio tecnico 9). Orden de los rechazos:
 *   1. 403 si viene cualquier campo fuera de la lista blanca, aunque traiga
 *      campos validos al lado: no se guarda nada (aceptacion 8, tecnico 6).
 *   2. 400 con un error por campo si algun valor es invalido (aceptacion 4).
 *   3. 200 con sin_cambios: true y sin escribir, si todo coincide con lo
 *      guardado (aceptacion 5).
 */
exports.updateMe = async (req, res) => {
    try {
        const cuerpo = req.body || {};

        const protegidos = camposProtegidos(cuerpo);
        if (protegidos.length > 0) {
            return res.status(403).json({
                msg: 'No puedes modificar estos datos desde tu perfil',
                codigo: 'PROHIBIDO',
                campos: protegidos,
                editables: CAMPOS_EDITABLES_PERFIL
            });
        }

        const { valores, errores } = validarPerfil(cuerpo);
        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Revisa los datos del perfil', codigo: 'VALIDACION', errores });
        }

        const resultado = await userService.updateProfile(req.user.id, valores);
        if (!resultado) return res.status(404).json({ msg: 'Usuario no encontrado', codigo: 'NO_ENCONTRADO' });

        const campos = Object.keys(resultado.cambios);
        if (campos.length === 0) {
            return res.status(200).json({
                ...resultado.perfil,
                msg: 'No hay cambios para guardar',
                sin_cambios: true,
                cambios: []
            });
        }

        // Solo los campos que cambiaron, con su valor anterior y el nuevo.
        dataLogs.registrarAccion({
            req,
            accion: dataLogs.ACCIONES.UPDATE,
            modulo: dataLogs.MODULOS.USERS,
            recurso: 'user_profile',
            recursoId: req.user.id,
            antes: Object.fromEntries(campos.map(c => [c, resultado.antes[c] ?? null])),
            despues: resultado.cambios
        });

        // El perfil va plano, como antes de esta HU (la pantalla de
        // notificaciones ya consumia esta respuesta); msg, sin_cambios y
        // cambios son campos nuevos al lado.
        res.status(200).json({
            ...resultado.perfil,
            msg: 'Perfil actualizado correctamente',
            sin_cambios: false,
            cambios: campos
        });
    } catch (error) {
        responderError(req, res, error);
    }
};
