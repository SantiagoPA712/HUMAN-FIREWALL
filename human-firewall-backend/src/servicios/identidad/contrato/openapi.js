/**
 * Contrato publico (OpenAPI) del servicio de identidad.
 *
 * Los cuerpos de entrada son los mismos objetos de api/esquemas.js que valida
 * la ruta: si cambia el DTO, cambia el contrato. Las respuestas se describen
 * aca. tests/contratos.test.mjs verifica que cada ruta real este documentada
 * (y al reves), que la seguridad coincida y que las respuestas reales
 * cumplan estos esquemas.
 */

const { operacion } = require('../../../compartido/contratos/operacion');
const { ref } = require('../../../compartido/contratos/esquemas-comunes');
const esquemas = require('../api/esquemas');
const { ROLES, IDIOMAS, CAMPOS_EDITABLES_PERFIL } = require('../dominio/usuario');

const fecha = { type: 'string', format: 'date-time' };
const fechaONull = { type: ['string', 'null'], format: 'date-time' };

const schemas = {
    Perfil: {
        type: 'object',
        required: ['id', 'email', 'role'],
        properties: {
            id: { type: 'integer' },
            email: { type: 'string', description: 'Solo lectura: es el usuario de login' },
            role: { type: 'string', enum: ROLES, description: 'Solo lectura' },
            full_name: { type: ['string', 'null'] },
            phone: { type: ['string', 'null'], description: 'Normalizado: + opcional y solo digitos' },
            language: { type: ['string', 'null'], enum: [...IDIOMAS, null] },
            team_name: { type: ['string', 'null'], description: 'Solo lectura' },
            created_at: fecha,
            updated_at: fechaONull
        }
    },
    PerfilActualizado: {
        type: 'object',
        description: 'El perfil completo, mas el resultado del guardado.',
        required: ['id', 'email', 'role', 'msg', 'sin_cambios', 'cambios'],
        properties: {
            id: { type: 'integer' },
            email: { type: 'string' },
            role: { type: 'string', enum: ROLES },
            full_name: { type: ['string', 'null'] },
            phone: { type: ['string', 'null'] },
            language: { type: ['string', 'null'], enum: [...IDIOMAS, null] },
            team_name: { type: ['string', 'null'] },
            created_at: fecha,
            updated_at: fechaONull,
            msg: { type: 'string' },
            sin_cambios: { type: 'boolean', description: 'true si todo coincidia con lo guardado: no se escribio nada' },
            cambios: { type: 'array', items: { type: 'string', enum: CAMPOS_EDITABLES_PERFIL } }
        }
    },
    CampoProtegido: {
        type: 'object',
        required: ['msg', 'codigo', 'campos', 'editables'],
        properties: {
            msg: { type: 'string' },
            codigo: { type: 'string', const: 'PROHIBIDO' },
            campos: { type: 'array', items: { type: 'string' }, description: 'Los campos rechazados' },
            editables: { type: 'array', items: { type: 'string', enum: CAMPOS_EDITABLES_PERFIL } }
        }
    },
    UsuarioResumen: {
        type: 'object',
        required: ['id', 'email', 'role'],
        properties: { id: { type: 'integer' }, email: { type: 'string' }, role: { type: 'string', enum: ROLES } }
    },
    CatalogoDeIdiomas: {
        type: 'object',
        required: ['idiomas', 'por_defecto'],
        properties: {
            idiomas: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['codigo', 'nombre'],
                    properties: {
                        codigo: { type: 'string', enum: IDIOMAS },
                        nombre: { type: 'string', description: 'El nombre del idioma, escrito en ese idioma' }
                    }
                }
            },
            por_defecto: { type: 'string', enum: IDIOMAS }
        }
    },
    RegistroCreado: {
        type: 'object',
        required: ['msg', 'token'],
        properties: { msg: { type: 'string' }, token: { type: 'string' } }
    },
    Invitacion: {
        type: 'object',
        required: ['id', 'email', 'role', 'estado', 'expires_at'],
        properties: {
            id: { type: 'integer' },
            email: { type: 'string' },
            role: { type: 'string' },
            language: { type: ['string', 'null'] },
            estado: { type: 'string', enum: ['pendiente', 'aceptada', 'expirada', 'cancelada'] },
            expires_at: fecha,
            invited_by: { type: ['integer', 'null'] },
            send_count: { type: 'integer' },
            resend_requested_at: fechaONull,
            accepted_user_id: { type: ['integer', 'null'] },
            created_at: fecha,
            accepted_at: fechaONull,
            cancelled_at: fechaONull,
            expired_at: fechaONull
        }
    },
    ListaDeInvitaciones: {
        type: 'object',
        required: ['resumen', 'invitaciones'],
        properties: {
            resumen: {
                type: 'object',
                properties: {
                    pendiente: { type: 'integer' }, aceptada: { type: 'integer' },
                    expirada: { type: 'integer' }, cancelada: { type: 'integer' }
                }
            },
            invitaciones: { type: 'array', items: ref('Invitacion') }
        }
    },
    InvitacionValida: {
        type: 'object',
        required: ['valida', 'email', 'role'],
        properties: {
            valida: { type: 'boolean', const: true },
            email: { type: 'string' },
            role: { type: 'string' },
            language: { type: ['string', 'null'] },
            expires_at: fecha
        }
    },
    InvitacionRechazada: {
        type: 'object',
        required: ['msg', 'motivo'],
        properties: {
            msg: { type: 'string' },
            motivo: { type: 'string', enum: ['invalida', 'usada', 'cancelada', 'expirada', 'vigente'] }
        }
    },
    RegistroPorInvitacion: {
        type: 'object',
        required: ['msg', 'token', 'user'],
        properties: { msg: { type: 'string' }, token: { type: 'string' }, user: { type: 'object' } }
    },
    PedidoDeReenvio: {
        type: 'object',
        required: ['msg', 'ya_solicitado'],
        properties: { msg: { type: 'string' }, ya_solicitado: { type: 'boolean' } }
    }
};

const mensaje = (descripcion) => ({ descripcion, esquema: ref('Mensaje') });

const rechazoDeInvitacion = {
    404: { descripcion: 'El token no existe', esquema: ref('InvitacionRechazada') },
    410: { descripcion: 'La invitacion ya se uso, se cancelo o vencio (ver `motivo`)', esquema: ref('InvitacionRechazada') }
};

const paths = {
    '/api/auth/login': {
        post: operacion({
            resumen: 'Iniciar sesion',
            descripcion: 'Devuelve el JWT. Un intento fallido queda en data.logs (sin la contrasena).',
            acceso: 'publica',
            dto: esquemas.login,
            validado: false,
            limitada: true,
            respuestas: { 200: { descripcion: 'Credenciales correctas', esquema: ref('Token') } },
            errores: [401]
        })
    },
    '/api/auth/logout': {
        post: operacion({
            resumen: 'Cerrar sesion',
            descripcion: 'Con JWT por encabezado, cerrar sesion es borrar el token en el cliente.',
            acceso: 'publica',
            respuestas: { 200: mensaje('Sesion cerrada') }
        })
    },
    '/api/auth/register': {
        post: operacion({
            resumen: 'Registrarse como empleado',
            descripcion: 'Crea la cuenta con rol employee, publica user.registered y devuelve el JWT.',
            acceso: 'publica',
            dto: esquemas.registro,
            validado: false,
            respuestas: {
                201: { descripcion: 'Cuenta creada', esquema: ref('RegistroCreado') },
                400: {
                    descripcion: 'Datos invalidos, contrasena debil o correo ya en uso (codigo CONFLICTO). ' +
                        'Se mantiene 400 y no 409 por compatibilidad: ver docs/contratos/CHANGELOG.md.',
                    esquema: ref('Error')
                }
            }
        })
    },
    '/api/auth/forgot-password': {
        post: operacion({
            resumen: 'Pedir recuperacion de contrasena',
            descripcion: 'Responde siempre lo mismo, exista o no la cuenta, para no revelar que correos estan registrados.',
            acceso: 'publica',
            dto: esquemas.olvideContrasena,
            respuestas: { 200: mensaje('Pedido recibido') }
        })
    },
    '/api/auth/reset-password': {
        post: operacion({
            resumen: 'Restablecer contrasena con el token de recuperacion',
            descripcion: 'Publica user.password_changed (correo critico de seguridad).',
            acceso: 'publica',
            dto: esquemas.restablecerContrasena,
            respuestas: { 200: mensaje('Contrasena actualizada') }
        })
    },
    '/api/users/idiomas': {
        get: operacion({
            resumen: 'Idiomas habilitados en la plataforma',
            descripcion: 'Catalogo y idioma por defecto. Lo consume el selector de preferencias, para que '
                       + 'la lista que se muestra salga de la misma fuente que valida PATCH /api/users/me.',
            acceso: 'autenticado',
            respuestas: {
                200: {
                    descripcion: 'Idiomas disponibles y cual rige sin preferencia configurada',
                    esquema: ref('CatalogoDeIdiomas')
                }
            }
        })
    },
    '/api/users/me': {
        get: operacion({
            resumen: 'Perfil propio',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Perfil del usuario del token', esquema: ref('Perfil') } },
            errores: [404]
        }),
        patch: operacion({
            resumen: 'Actualizar el perfil propio',
            descripcion: 'Solo se pueden cambiar ' + CAMPOS_EDITABLES_PERFIL.join(', ') + '. Cualquier otro campo ' +
                '(role, is_active, email, ...) rechaza la solicitud entera con 403, sin guardar nada. ' +
                'Si ningun valor cambia responde 200 con sin_cambios: true y no escribe. ' +
                'Cada guardado con cambios queda en data.logs con el valor anterior y el nuevo.',
            acceso: 'autenticado',
            dto: esquemas.actualizarPerfil,
            respuestas: {
                200: { descripcion: 'Perfil guardado, o sin cambios (ver sin_cambios)', esquema: ref('PerfilActualizado') },
                400: { descripcion: 'Formato incorrecto o campo obligatorio vacio, con un error por campo', esquema: ref('ErrorDeValidacion') },
                403: { descripcion: 'La solicitud intenta cambiar un campo protegido', esquema: ref('CampoProtegido') }
            },
            errores: [404]
        })
    },
    '/api/users': {
        get: operacion({
            resumen: 'Listar usuarios',
            acceso: ['admin'],
            respuestas: { 200: { descripcion: 'Todos los usuarios', esquema: { type: 'array', items: ref('UsuarioResumen') } } }
        }),
        post: operacion({
            resumen: 'Crear un usuario',
            descripcion: 'Queda registrado en data.logs (la contrasena, enmascarada).',
            acceso: ['admin'],
            dto: esquemas.crearUsuario,
            respuestas: { 201: mensaje('Usuario creado') },
            errores: [409]
        })
    },
    '/api/users/{id}': {
        put: operacion({
            resumen: 'Cambiar rol o estado de un usuario',
            descripcion: 'Un cambio de rol queda en data.logs como role_change, con el valor anterior y el nuevo.',
            acceso: ['admin'],
            dto: esquemas.actualizarUsuario,
            respuestas: { 200: mensaje('Usuario actualizado') },
            errores: [404]
        }),
        delete: operacion({
            resumen: 'Desactivar un usuario (baja logica)',
            acceso: ['admin'],
            dto: esquemas.porId,
            respuestas: { 200: mensaje('Usuario desactivado') },
            errores: [404]
        })
    },
    '/api/sso/google': {
        get: operacion({
            resumen: 'Entrar con Google',
            descripcion: 'Redirige a la pantalla de consentimiento de Google.',
            acceso: 'publica',
            respuestas: { 302: { descripcion: 'Redireccion a Google' } }
        })
    },
    '/api/sso/google/callback': {
        get: operacion({
            resumen: 'Regreso desde Google',
            descripcion: 'Crea la cuenta si no existia y redirige a /dashboard?token=<JWT>.',
            acceso: 'publica',
            respuestas: { 302: { descripcion: 'Redireccion al dashboard con el token, o a /login?error=sso_failed' } }
        })
    },
    '/api/invitations/validar': {
        post: operacion({
            resumen: 'Validar un enlace de invitacion',
            descripcion: 'El token viaja en el cuerpo, nunca en la URL.',
            acceso: 'publica',
            dto: esquemas.tokenDeInvitacion,
            validado: false,
            limitada: true,
            respuestas: { 200: { descripcion: 'Se puede mostrar el formulario', esquema: ref('InvitacionValida') }, ...rechazoDeInvitacion }
        })
    },
    '/api/invitations/aceptar': {
        post: operacion({
            resumen: 'Completar el registro desde una invitacion',
            acceso: 'publica',
            dto: esquemas.aceptarInvitacion,
            validado: false,
            limitada: true,
            respuestas: {
                201: { descripcion: 'Cuenta creada con el rol de la invitacion', esquema: ref('RegistroPorInvitacion') },
                ...rechazoDeInvitacion
            },
            errores: [409]
        })
    },
    '/api/invitations/solicitar-reenvio': {
        post: operacion({
            resumen: 'Pedir una invitacion nueva (enlace vencido)',
            acceso: 'publica',
            dto: esquemas.tokenDeInvitacion,
            validado: false,
            limitada: true,
            respuestas: { 202: { descripcion: 'Aviso enviado al administrador', esquema: ref('PedidoDeReenvio') }, ...rechazoDeInvitacion },
            errores: [409]
        })
    },
    '/api/invitations': {
        get: operacion({
            resumen: 'Panel de invitaciones',
            acceso: ['admin'],
            dto: esquemas.filtroDeInvitaciones,
            validado: false,
            respuestas: { 200: { descripcion: 'Resumen por estado e invitaciones', esquema: ref('ListaDeInvitaciones') } }
        }),
        post: operacion({
            resumen: 'Invitar a una persona',
            descripcion: 'Encola el correo con el enlace; en la base solo queda el SHA-256 del token.',
            acceso: ['admin'],
            dto: esquemas.invitar,
            validado: false,
            respuestas: { 201: { descripcion: 'Invitacion creada', esquema: ref('Invitacion') } },
            errores: [409]
        })
    },
    '/api/invitations/{id}/reenviar': {
        post: operacion({
            resumen: 'Reenviar una invitacion',
            descripcion: 'Genera un enlace nuevo; el anterior deja de funcionar.',
            acceso: ['admin'],
            dto: esquemas.porId,
            validado: false,
            respuestas: { 200: { descripcion: 'Invitacion reenviada', esquema: ref('Invitacion') } },
            errores: [404, 409]
        })
    },
    '/api/invitations/{id}/cancelar': {
        post: operacion({
            resumen: 'Cancelar una invitacion',
            acceso: ['admin'],
            dto: esquemas.porId,
            validado: false,
            respuestas: { 200: { descripcion: 'Invitacion cancelada', esquema: ref('Invitacion') } },
            errores: [404, 409]
        })
    }
};

module.exports = { paths, schemas };
