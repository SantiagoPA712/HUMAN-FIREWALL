/**
 * Firma de JWT con el secreto de JWT_SECRET (sin valor por defecto).
 */

const jwt = require('jsonwebtoken');
const { secretoJwt } = require('../config/entorno');

/**
 * Firma un JWT. El secreto sale de JWT_SECRET y no tiene valor por defecto:
 * si falta, esto lanza un error explicito (y server.js ni siquiera arranca).
 */
exports.generateToken = (payload) => {
    return jwt.sign(payload, secretoJwt(), {
        expiresIn: process.env.JWT_EXPIRES || '1d'
    });
};
