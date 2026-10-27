/**
 * Actividad de los usuarios, armada con los contratos de los servicios que
 * la registran.
 *
 * Capa Application / Service. "Actividad" son los tres hechos que el sistema
 * guarda por si mismo: movimientos de puntos (gamificacion), intentos de
 * evaluacion (evaluaciones) y lecciones completadas (cursos). Cada uno vive
 * en la base de su servicio, asi que reportes ya no los une con un JOIN: le
 * pide a cada servicio su parte y las suma en memoria.
 */

const gamificacion = require('../infrastructure/client/gamificacion.cliente');
const evaluaciones = require('../infrastructure/client/evaluaciones.cliente');
const cursos = require('../infrastructure/client/cursos.cliente');

const FUENTES = [gamificacion, evaluaciones, cursos];

/**
 * Acciones por usuario en [desde, hasta). Cualquiera de los dos limites puede
 * ser null (sin limite).
 *
 * @returns {Promise<Map<number, number>>} user_id -> cantidad de acciones
 */
async function accionesPorUsuario(desde = null, hasta = null) {
    const partes = await Promise.all(FUENTES.map(f => f.accionesPorUsuarioEntre(desde, hasta)));
    const total = new Map();
    for (const filas of partes) {
        for (const { user_id, acciones } of filas) total.set(user_id, (total.get(user_id) || 0) + acciones);
    }
    return total;
}

/**
 * Ultima actividad de cada usuario: el maximo entre las tres fuentes.
 *
 * @returns {Promise<Map<number, Date>>}
 */
async function ultimaActividad(userIds) {
    const ultima = new Map();
    if (userIds.length === 0) return ultima;
    const partes = await Promise.all(FUENTES.map(f => f.ultimaActividadDe(userIds)));
    for (const filas of partes) {
        for (const { user_id, ultima: momento } of filas) {
            const previa = ultima.get(user_id);
            if (!previa || new Date(momento) > new Date(previa)) ultima.set(user_id, momento);
        }
    }
    return ultima;
}

/**
 * Agrupa usuarios por area como hacia el GROUPING SETS ((team_id), ()) de
 * antes: una fila por cada team_id presente (incluido el de quienes no tienen
 * area, con area_id null) y una fila de total de la organizacion
 * (total_org = 1).
 *
 * @param {object[]} usuarios   cuentas activas con team_id
 * @param {(u: object) => object} medir  valores numericos a sumar por usuario
 */
function agruparPorArea(usuarios, medir) {
    const grupos = new Map();
    const total = { area_id: null, total_org: 1 };
    const sumar = (destino, valores) => {
        for (const [clave, valor] of Object.entries(valores)) destino[clave] = (destino[clave] || 0) + valor;
    };

    for (const u of usuarios) {
        const valores = medir(u);
        const clave = u.team_id ?? null;
        if (!grupos.has(clave)) grupos.set(clave, { area_id: clave, total_org: 0 });
        sumar(grupos.get(clave), valores);
        sumar(total, valores);
    }

    // El total existe aunque no haya nadie, igual que la fila () del GROUPING SETS.
    const claves = Object.keys(usuarios.length ? medir(usuarios[0]) : {});
    for (const c of claves) if (total[c] === undefined) total[c] = 0;
    return [...grupos.values(), total];
}

/** Suma un dia a una fecha YYYY-MM-DD (el "hasta" inclusivo de los filtros de RH). */
function diaSiguiente(fecha) {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

module.exports = { accionesPorUsuario, ultimaActividad, agruparPorArea, diaSiguiente };
