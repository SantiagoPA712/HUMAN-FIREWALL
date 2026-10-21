/**
 * Ficha del servicio de identidad.
 *
 * Es la fuente de verdad de lo que el servicio declara ser: que hace, que
 * rutas expone, de que tablas es dueno, que eventos publica y consume, y con
 * quien habla. La documentacion se arma con esto y las pruebas de
 * arquitectura verifican que el codigo real coincida.
 */
module.exports = {
    nombre: 'identidad',
    responsabilidad:
        'Cuentas de usuario, autenticacion (correo/contrasena y Google), ' +
        'recuperacion de contrasena, roles, perfil propio, equipos e invitaciones.',
    prefijos: ['/api/auth', '/api/users', '/api/sso', '/api/invitations'],
    // Esquemas de PostgreSQL del servicio (migracion 090). Sus tablas viven ahi.
    esquemas: ['identidad'],
    tablas: ['identidad.users', 'identidad.password_reset_tokens', 'identidad.user_invitations', 'identidad.user_invitation_events', 'identidad.teams'],
    publica: ['user.registered', 'user.password_changed', 'user.invited'],
    consume: [],
    dependeDe: ['seguridad', 'notificaciones'],
    lecturasCompartidas: [],
    escriturasCompartidas: [],
    procesos: []
};
