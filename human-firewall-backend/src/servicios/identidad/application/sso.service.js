/**
 * Caso de uso de ingreso con Google: busca la cuenta por correo y, si no
 * existe, la crea y publica user.registered.
 *
 * Capa Application / Service. Lo llama la integracion con passport
 * (infrastructure/passport.js) cuando Google confirma la identidad.
 */

const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const usuarios = require('../infrastructure/persistence/usuarios.repositorio');

/**
 * @param {{ email: string, oauthId: string }} perfil  lo que devolvio Google
 * @returns {Promise<object>} la cuenta
 */
async function ingresarConGoogle({ email, oauthId }) {
    const existente = await usuarios.buscarPorCorreo(email);

    if (existente) {
        if (!existente.oauth_provider) await usuarios.vincularGoogle(existente.id, oauthId);
        return existente;
    }

    // Entrar por Google y entrar por formulario son dos caminos distintos que
    // producen el MISMO hecho. Publicando el mismo evento en ambos, el correo
    // de bienvenida y todo lo que venga despues funcionan igual.
    const nuevo = await usuarios.insertarConGoogle({ email, oauthId });
    await eventBus.publish(EVENTOS.USER_REGISTERED, {
        userId: nuevo.id,
        email: nuevo.email,
        role: nuevo.role,
        provider: 'google'
    });
    return nuevo;
}

module.exports = { ingresarConGoogle };
