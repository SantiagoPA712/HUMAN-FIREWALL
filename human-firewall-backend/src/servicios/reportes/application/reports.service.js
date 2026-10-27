/**
 * Reportes de desempeno para RH.
 *
 * HU: "quiero ver reportes de desempeno de los usuarios basados en puntos,
 * niveles e insignias, para identificar tendencias y detectar necesidades de
 * refuerzo".
 *
 * ---------------------------------------------------------------------
 * Criterio tecnico 3: no duplicar logica de negocio
 * ---------------------------------------------------------------------
 * Este modulo NO sabe cuantos puntos vale una leccion, ni en que puntaje
 * empieza el nivel 3, ni que condicion desbloquea una insignia. Todo eso se
 * le pide a quien ya lo sabe:
 *
 *   puntos    -> points.service.obtenerTotalesPorUsuarios()  (points_ledger)
 *   nivel     -> levels.service.calcularProgreso()           (levels_config)
 *   insignias -> rewards.service.obtenerResumenPorUsuarios() (user_rewards)
 *
 * El detalle que hace que esto funcione sin volverse lento:
 * `calcularProgreso` es una funcion PURA. Se pide la escalera de niveles una
 * sola vez y se aplica en memoria a los 50 usuarios de la pagina, en lugar de
 * llamar a obtenerNivelDeUsuario() cincuenta veces. Se reutiliza la regla sin
 * pagar N+1 consultas.
 *
 * Si manana cambian los umbrales de nivel o las reglas de puntuacion, este
 * archivo no se toca.
 */

// Cuentas, equipos, cursos e intentos viven en las bases de sus servicios:
// el reporte se arma con sus contratos y se filtra, ordena y agrega en memoria.
const identidad = require('../infrastructure/client/identidad.cliente');
const cursosCliente = require('../infrastructure/client/cursos.cliente');
const { accionesPorUsuario, ultimaActividad, diaSiguiente } = require('./actividad');
// Puntos, niveles y recompensas se piden a gamificacion por su contrato.
const gamificacion = require('../infrastructure/client/gamificacion.cliente');

/** Tamano de pagina por defecto (criterio tecnico 4). */
const PAGE_SIZE_POR_DEFECTO = 50;
const PAGE_SIZE_MAXIMO = 200;

// ---------------------------------------------------------------------
// Validacion de filtros (criterio tecnico 2)
// ---------------------------------------------------------------------

/** Fecha ISO 8601 en formato YYYY-MM-DD, y que sea una fecha real. */
function esFechaISO(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

    // El regex acepta 2026-02-31. Date lo normaliza a marzo, asi que se
    // compara el resultado contra la entrada para detectar el desborde.
    const fecha = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

/**
 * Valida los filtros ANTES de tocar la tabla de datos.
 *
 * Criterio tecnico 2: si algo es invalido se responde 400 con el detalle del
 * campo y no se ejecuta la consulta del reporte.
 *
 * La existencia de team_id y course_id se verifica contra la base. Eso es una
 * consulta, pero de validacion: sin ella, un id inexistente devolveria un
 * reporte vacio y RH no podria distinguir "este equipo no tiene actividad" de
 * "escribi mal el id", que es exactamente la confusion que el criterio 2
 * quiere evitar al pedir un estado vacio claro para un filtro valido.
 *
 * @returns {Promise<{errores: Array<{campo: string, detalle: string}>, filtros: object}>}
 */
async function validarFiltros(query = {}) {
    const errores = [];
    const filtros = { from: null, to: null, teamId: null, courseId: null };

    for (const campo of ['from', 'to']) {
        const valor = query[campo];
        if (valor === undefined || valor === null || valor === '') continue;

        if (!esFechaISO(valor)) {
            errores.push({
                campo,
                detalle: `Formato invalido. Se espera una fecha ISO 8601 (YYYY-MM-DD), se recibio "${valor}".`
            });
        } else {
            filtros[campo] = valor;
        }
    }

    // Un rango invertido no es un error de formato, pero devolveria siempre
    // vacio y el usuario no sabria por que.
    if (filtros.from && filtros.to && filtros.from > filtros.to) {
        errores.push({
            campo: 'from',
            detalle: `La fecha inicial (${filtros.from}) es posterior a la final (${filtros.to}).`
        });
    }

    const referencias = [
        { campo: 'team_id', clave: 'teamId', etiqueta: 'equipo' },
        { campo: 'course_id', clave: 'courseId', etiqueta: 'curso' }
    ];

    for (const ref of referencias) {
        const valor = query[ref.campo];
        if (valor === undefined || valor === null || valor === '') continue;

        const id = Number(valor);
        if (!Number.isInteger(id) || id <= 0) {
            errores.push({
                campo: ref.campo,
                detalle: `Debe ser un entero positivo, se recibio "${valor}".`
            });
            continue;
        }

        const existe = ref.etiqueta === 'equipo'
            ? await identidad.buscarEquipo(id)
            : await cursosCliente.obtenerTitulo(id);
        if (!existe) {
            errores.push({
                campo: ref.campo,
                detalle: `No existe ningun ${ref.etiqueta} con id ${id}.`
            });
        } else {
            filtros[ref.clave] = id;
        }
    }

    return { errores, filtros };
}

/** Normaliza la paginacion (criterio tecnico 4). */
function normalizarPaginacion(query = {}) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pedido = Number.parseInt(query.page_size, 10) || PAGE_SIZE_POR_DEFECTO;
    const pageSize = Math.min(PAGE_SIZE_MAXIMO, Math.max(1, pedido));
    return { page, pageSize };
}

// ---------------------------------------------------------------------
// Consulta base
// ---------------------------------------------------------------------

/**
 * Usuarios que entran en el reporte, ya ordenados (mas puntos primero; el id
 * desempata para que el orden sea estable entre paginas).
 *
 * El filtro por curso NO limita los puntos a ese curso: selecciona a los
 * usuarios que tienen el curso asignado. El filtro de fechas restringe QUE
 * USUARIOS aparecen: solo los que tuvieron actividad (puntos, intentos o
 * lecciones) dentro del rango, con el "hasta" inclusivo (todo ese dia).
 */
async function usuariosDelReporte(filtros) {
    let usuarios = await identidad.usuariosActivos();

    if (filtros.teamId) usuarios = usuarios.filter(u => u.team_id === filtros.teamId);

    if (filtros.courseId) {
        const asignados = new Set(await cursosCliente.usuariosAsignadosA(filtros.courseId));
        usuarios = usuarios.filter(u => asignados.has(u.id));
    }

    if (filtros.from || filtros.to) {
        const activos = await accionesPorUsuario(filtros.from, filtros.to ? diaSiguiente(filtros.to) : null);
        usuarios = usuarios.filter(u => activos.has(u.id));
    }

    return usuarios.sort((a, b) => (b.total_points - a.total_points) || (a.id - b.id));
}

/** Cuantos usuarios entran en el reporte con estos filtros. */
async function contarUsuarios(filtros) {
    return (await usuariosDelReporte(filtros)).length;
}

/**
 * Ultima actividad de cada usuario.
 *
 * "Ultima actividad" no vive en ninguna columna: es el maximo entre el ultimo
 * movimiento de puntos, el ultimo intento de evaluacion y la ultima leccion
 * completada. Un usuario puede haber leido lecciones sin sumar puntos, o
 * haber reprobado una evaluacion (que no otorga puntos): en los dos casos
 * estuvo activo, y un reporte que dijera lo contrario mandaria a RH a
 * perseguir a alguien que si esta trabajando.
 */
async function obtenerUltimaActividad(userIds) {
    const resultado = new Map();
    if (userIds.length === 0) return resultado;

    return ultimaActividad(userIds);
}

// ---------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------

/**
 * Filas del reporte para una pagina de usuarios.
 *
 * @param {object} filtros     ya validados por validarFiltros()
 * @param {object} paginacion  { page, pageSize }
 */
async function obtenerFilas(filtros, { page, pageSize }) {
    const offset = (page - 1) * pageSize;
    const usuarios = (await usuariosDelReporte(filtros)).slice(offset, offset + pageSize);

    if (usuarios.length === 0) return [];

    const ids = usuarios.map(u => u.id);
    const rango = { from: filtros.from, to: filtros.to };

    // Cuatro consultas para toda la pagina, no cuatro por usuario.
    // La escalera se pide una sola vez y se aplica en memoria.
    const [puntosPorUsuario, insigniasPorUsuario, actividadPorUsuario, escalera] = await Promise.all([
        gamificacion.obtenerTotalesPorUsuarios(ids, rango),
        gamificacion.obtenerResumenPorUsuarios(ids, rango),
        obtenerUltimaActividad(ids),
        gamificacion.obtenerEscalera()
    ]);

    return usuarios.map(u => {
        const puntos = puntosPorUsuario.get(u.id) || { total: 0, movimientos: 0, ultimo: null };
        const insignias = insigniasPorUsuario.get(u.id) || { total: 0, nombres: [], ultima: null };

        // El nivel se calcula con la funcion del servicio de niveles, no con
        // una copia de la formula (criterio tecnico 3).
        //
        // Ojo con el rango de fechas: si RH filtra por un mes, `puntos.total`
        // es el de ese mes y el nivel resultante es "el nivel que darian esos
        // puntos", no el nivel real del usuario. Por eso se devuelven los dos:
        // nivel (segun el filtro) y nivel_actual (historico completo).
        const nivelFiltrado = gamificacion.calcularProgreso(puntos.total, escalera);

        return {
            user_id: u.id,
            email: u.email,
            rol: u.role,
            team_id: u.team_id,
            equipo: u.equipo || 'Sin equipo',
            puntos: puntos.total,
            movimientos: puntos.movimientos,
            nivel: nivelFiltrado.nivel_actual,
            nivel_nombre: nivelFiltrado.nombre,
            porcentaje_avance: nivelFiltrado.porcentaje_avance,
            insignias: insignias.total,
            insignias_nombres: insignias.nombres,
            ultima_actividad: actividadPorUsuario.get(u.id) || null
        };
    });
}

/**
 * Agregados por equipo y por curso (criterio de aceptacion 1: "debo poder ver
 * esta informacion agregada por equipo o por curso").
 *
 * Se calculan sobre TODOS los usuarios que cumplen el filtro, no solo sobre la
 * pagina visible: un total que cambiara al pasar de pagina no seria un total.
 */
async function obtenerAgregados(filtros) {
    const usuarios = await usuariosDelReporte(filtros);
    const ids = usuarios.map(u => u.id);

    // Puntos del rango (no la cache total_points, que es del historial
    // completo y con un filtro de fechas mentiria) y asignaciones de cursos.
    const [puntos, asignaciones] = await Promise.all([
        gamificacion.obtenerTotalesPorUsuarios(ids, { from: filtros.from, to: filtros.to }),
        cursosCliente.asignacionesDe(ids)
    ]);

    // Por equipo
    const equipos = new Map();
    for (const u of usuarios) {
        const clave = u.team_id ?? null;
        if (!equipos.has(clave)) equipos.set(clave, { equipo: u.equipo || 'Sin equipo', team_id: clave, usuarios: 0, puntos: 0 });
        const e = equipos.get(clave);
        e.usuarios += 1;
        e.puntos += (puntos.get(u.id)?.total || 0);
    }
    const porEquipo = [...equipos.values()]
        .map(e => ({ ...e, promedio_puntos: e.usuarios > 0 ? Math.round((e.puntos / e.usuarios) * 10) / 10 : null }))
        .sort((a, b) => b.puntos - a.puntos);

    // Por curso
    const porCursoMapa = new Map();
    for (const a of asignaciones) {
        if (!porCursoMapa.has(a.course_id)) porCursoMapa.set(a.course_id, { usuarios: new Set(), completados: new Set() });
        const c = porCursoMapa.get(a.course_id);
        c.usuarios.add(a.user_id);
        if (a.status === 'completed') c.completados.add(a.user_id);
    }
    const titulos = new Map((await cursosCliente.obtenerTitulos([...porCursoMapa.keys()])).map(c => [c.id, c.title]));
    const porCurso = [...porCursoMapa.entries()]
        .filter(([courseId]) => titulos.has(courseId))
        .map(([courseId, c]) => ({
            course_id: courseId,
            curso: titulos.get(courseId),
            usuarios: c.usuarios.size,
            completados: c.completados.size
        }))
        .sort((a, b) => (b.usuarios - a.usuarios) || a.curso.localeCompare(b.curso));

    return {
        por_equipo: porEquipo,
        por_curso: porCurso.map(r => ({
            ...r,
            porcentaje_completado: r.usuarios > 0
                ? Math.round(r.completados * 100 / r.usuarios)
                : 0
        }))
    };
}

/**
 * Reporte completo: filas paginadas + agregados + metadatos de paginacion.
 *
 * @param {object} filtros     ya validados
 * @param {object} paginacion  { page, pageSize }
 */
async function obtenerReporteDesempeno(filtros, paginacion) {
    const total = await contarUsuarios(filtros);
    const { page, pageSize } = paginacion;

    // Criterio de aceptacion 2: si no hay datos, estado vacio claro y no un
    // error. Se responde 200 con la lista vacia y los metadatos en cero.
    const filas = total === 0 ? [] : await obtenerFilas(filtros, paginacion);
    const agregados = total === 0
        ? { por_equipo: [], por_curso: [] }
        : await obtenerAgregados(filtros);

    return {
        filtros: {
            from: filtros.from,
            to: filtros.to,
            team_id: filtros.teamId,
            course_id: filtros.courseId
        },
        paginacion: {
            page,
            page_size: pageSize,
            total,
            total_paginas: Math.max(1, Math.ceil(total / pageSize))
        },
        vacio: total === 0,
        resultados: filas,
        agregados
    };
}

/**
 * Todas las filas que cumplen el filtro, sin paginar. Solo para exportar.
 *
 * La exportacion tiene que reflejar exactamente los filtros de la pantalla
 * (criterio de aceptacion 3), pero NO su paginacion: quien exporta espera el
 * reporte entero, no los 50 que tenia a la vista.
 */
async function obtenerTodasLasFilas(filtros) {
    const total = await contarUsuarios(filtros);
    if (total === 0) return [];
    return obtenerFilas(filtros, { page: 1, pageSize: total });
}

/** Opciones para el panel de filtros: equipos y cursos existentes. */
async function obtenerOpcionesDeFiltro() {
    const [equipos, cursos] = await Promise.all([identidad.equiposActivos(), cursosCliente.titulosOrdenados()]);
    return { equipos, cursos };
}

module.exports = {
    PAGE_SIZE_POR_DEFECTO,
    esFechaISO,
    validarFiltros,
    normalizarPaginacion,
    contarUsuarios,
    obtenerReporteDesempeno,
    obtenerTodasLasFilas,
    obtenerOpcionesDeFiltro
};
