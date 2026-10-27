/**
 * Configuracion del servicio de evaluaciones (equivale al application.yml de
 * la seccion 11 del material).
 *
 * Este servicio no lee variables de entorno propias. El puntaje minimo para
 * aprobar es una regla de negocio y vive en domain/puntaje.js, no aca.
 */

const entorno = require('../../../compartido/config/entorno');
const bases = require('../../../compartido/config/bases');

module.exports = {
    nombre: 'evaluaciones',

    /**
     * Base de datos propia del servicio (el spring.datasource.url del
     * application.yml del material): EVALUACIONES_DATABASE_URL, o la de DATABASE_URL con el
     * sufijo _evaluaciones cuando BASES_POR_SERVICIO=true.
     */
    get baseDeDatos() { return entorno.texto('EVALUACIONES_DATABASE_URL', bases.urlPorDefecto('evaluaciones')); },
};
