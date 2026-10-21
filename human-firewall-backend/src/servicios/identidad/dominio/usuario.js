/**
 * Reglas del dominio de identidad. Funciones y constantes puras.
 */

/** Mismos valores que el CHECK de users.role (migracion 032). */
const ROLES = ['employee', 'instructor', 'admin', 'rh', 'security', 'manager'];

/** Mismos valores que el CHECK de users.language (migracion 034). */
const IDIOMAS = ['es', 'en'];

/**
 * Nombre de cada idioma, escrito en ese mismo idioma.
 *
 * Vive aca y no en la interfaz porque el criterio tecnico 7 de la HU de
 * preferencia de idioma pide aceptar unicamente los idiomas habilitados en el
 * sistema: si la lista estuviera quemada en el frontend habria dos fuentes de
 * verdad, y agregar un idioma obligaria a acordarse de tocar las dos.
 *
 * El nombre va en su propio idioma ("English", no "Ingles") porque quien lo
 * busca en la lista es justamente quien todavia no entiende el idioma actual.
 */
const NOMBRES_DE_IDIOMA = {
    es: 'Español',
    en: 'English'
};

/** Idioma de la plataforma cuando el usuario no configuro ninguno (CA 5). */
const IDIOMA_POR_DEFECTO = 'es';

/** Catalogo que consume el selector de la interfaz. */
const catalogoDeIdiomas = () => ({
    idiomas: IDIOMAS.map(codigo => ({ codigo, nombre: NOMBRES_DE_IDIOMA[codigo] })),
    por_defecto: IDIOMA_POR_DEFECTO
});


/** Politica de contrasena: minimo 8 caracteres, una mayuscula y un numero. */
const POLITICA_CONTRASENA = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const MENSAJE_POLITICA = 'La contraseña debe tener mínimo 8 caracteres, al menos una mayúscula y un número';

const cumplePolitica = (password) => typeof password === 'string' && POLITICA_CONTRASENA.test(password);

// ---------------------------------------------------------------------
// Perfil propio (HU de perfil editable)
// ---------------------------------------------------------------------

/**
 * Lo unico que el empleado puede cambiar de su cuenta (criterio tecnico 3).
 * Es una lista blanca a proposito: cualquier otro campo que llegue en la
 * solicitud (role, is_active, email, team_id, total_points, ...) se rechaza
 * entero, aunque venga acompanado de campos validos (criterio tecnico 6).
 * Ignorarlo en silencio le haria creer a quien manipula la solicitud que
 * "se guardo", y no deja rastro de que alguien lo intento.
 */
const CAMPOS_EDITABLES_PERFIL = ['full_name', 'phone', 'language'];

const LARGO_NOMBRE = { min: 2, max: 150 };

// Letras de cualquier idioma (tildes, enie), espacios, apostrofo, punto y
// guion: "Maria Jose O'Neill-Gomez". Sin numeros ni simbolos.
const FORMATO_NOMBRE = /^\p{L}[\p{L}\s'.-]*$/u;

// Normalizado: '+' opcional y de 7 a 15 digitos (E.164). Mismo CHECK que la
// migracion 036.
const FORMATO_TELEFONO = /^\+?[0-9]{7,15}$/;

/** Campos de la solicitud que no estan en la lista blanca. */
function camposProtegidos(cuerpo) {
    return Object.keys(cuerpo || {}).filter(c => !CAMPOS_EDITABLES_PERFIL.includes(c));
}

const normalizarNombre = (v) => v.trim().replace(/\s+/g, ' ');

/** Quita lo que la persona escribe para leer el numero: espacios, guiones, parentesis y puntos. */
const normalizarTelefono = (v) => v.replace(/[\s().-]/g, '');

/**
 * Valida y normaliza los campos editables que trae la solicitud (criterios
 * de aceptacion 4 y tecnico 5). Solo mira los que vienen: un PATCH puede
 * cambiar uno solo.
 *
 * @returns {{ valores: object, errores: Array<{campo, detalle}> }}
 *          valores normalizados listos para comparar y guardar
 */
function validarPerfil(cuerpo) {
    const valores = {};
    const errores = [];
    const viene = (c) => Object.prototype.hasOwnProperty.call(cuerpo || {}, c);

    if (viene('full_name')) {
        const v = cuerpo.full_name;
        if (typeof v !== 'string' || normalizarNombre(v) === '') {
            errores.push({ campo: 'full_name', detalle: 'El nombre es obligatorio.' });
        } else {
            const nombre = normalizarNombre(v);
            if (nombre.length < LARGO_NOMBRE.min || nombre.length > LARGO_NOMBRE.max) {
                errores.push({
                    campo: 'full_name',
                    detalle: `El nombre debe tener entre ${LARGO_NOMBRE.min} y ${LARGO_NOMBRE.max} caracteres.`
                });
            } else if (!FORMATO_NOMBRE.test(nombre)) {
                errores.push({
                    campo: 'full_name',
                    detalle: 'El nombre solo puede tener letras, espacios, apostrofos, puntos y guiones.'
                });
            } else {
                valores.full_name = nombre;
            }
        }
    }

    if (viene('phone')) {
        const v = cuerpo.phone;
        // El telefono es opcional: vacio o null lo borra.
        if (v === null || (typeof v === 'string' && v.trim() === '')) {
            valores.phone = null;
        } else if (typeof v !== 'string' || !FORMATO_TELEFONO.test(normalizarTelefono(v))) {
            errores.push({
                campo: 'phone',
                detalle: 'El telefono debe tener entre 7 y 15 digitos, con un + opcional al inicio (por ejemplo +57 300 123 4567).'
            });
        } else {
            valores.phone = normalizarTelefono(v);
        }
    }

    if (viene('language')) {
        const v = cuerpo.language;
        if (v !== null && !IDIOMAS.includes(v)) {
            errores.push({
                campo: 'language',
                detalle: `Idioma invalido. Validos: ${IDIOMAS.join(', ')} o null para el de la plataforma.`
            });
        } else {
            valores.language = v;
        }
    }

    return { valores, errores };
}

/** Solo los campos cuyo valor es distinto del guardado (criterio de aceptacion 5). */
function cambiosDePerfil(actual, valores) {
    const cambios = {};
    for (const [campo, valor] of Object.entries(valores)) {
        if ((actual[campo] ?? null) !== valor) cambios[campo] = valor;
    }
    return cambios;
}

module.exports = {
    ROLES,
    IDIOMAS,
    NOMBRES_DE_IDIOMA,
    IDIOMA_POR_DEFECTO,
    catalogoDeIdiomas,
    POLITICA_CONTRASENA,
    MENSAJE_POLITICA,
    cumplePolitica,
    CAMPOS_EDITABLES_PERFIL,
    camposProtegidos,
    validarPerfil,
    cambiosDePerfil
};
