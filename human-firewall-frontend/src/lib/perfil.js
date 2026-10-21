/**
 * Reglas del perfil propio del lado del cliente (HU de perfil editable,
 * criterio tecnico 4).
 *
 * Son las mismas que valida el backend en servicios/identidad/dominio/usuario.js:
 * aca sirven para avisar antes de enviar, no para proteger nada. Si alguien
 * se saltea la pantalla, el backend vuelve a validar y rechaza.
 */

/** Lo unico editable. Correo, rol y equipo se muestran pero no se tocan. */
export const CAMPOS_EDITABLES = ['full_name', 'phone', 'language'];

const FORMATO_NOMBRE = /^\p{L}[\p{L}\s'.-]*$/u;
const FORMATO_TELEFONO = /^\+?[0-9]{7,15}$/;

const normalizarNombre = (v) => v.trim().replace(/\s+/g, ' ');
const normalizarTelefono = (v) => v.replace(/[\s().-]/g, '');

/** Estado del formulario a partir del perfil guardado. */
export function formularioDesde(perfil) {
    return {
        full_name: perfil?.full_name || '',
        phone: perfil?.phone || '',
        language: perfil?.language || ''
    };
}

/**
 * Valida el formulario y lo deja listo para enviar.
 *
 * @returns {{ errores: Record<string,string>, valores: object }}
 *          un mensaje por campo con problema, y los valores normalizados
 *          (telefono e idioma vacios -> null)
 */
export function validarFormulario(formulario) {
    const errores = {};
    const nombre = normalizarNombre(formulario.full_name || '');

    if (nombre === '') {
        errores.full_name = 'El nombre es obligatorio.';
    } else if (nombre.length < 2 || nombre.length > 150) {
        errores.full_name = 'El nombre debe tener entre 2 y 150 caracteres.';
    } else if (!FORMATO_NOMBRE.test(nombre)) {
        errores.full_name = 'Usa solo letras, espacios, apóstrofos, puntos y guiones.';
    }

    const telefono = normalizarTelefono(formulario.phone || '');
    if (telefono !== '' && !FORMATO_TELEFONO.test(telefono)) {
        errores.phone = 'Debe tener entre 7 y 15 dígitos, con un + opcional al inicio. Ejemplo: +57 300 123 4567.';
    }

    return {
        errores,
        valores: {
            full_name: nombre,
            phone: telefono === '' ? null : telefono,
            language: formulario.language || null
        }
    };
}

/** Solo lo que cambio respecto de lo guardado (criterio de aceptacion 5). */
export function cambiosRespectoDe(perfil, valores) {
    const cambios = {};
    for (const campo of CAMPOS_EDITABLES) {
        if ((perfil?.[campo] ?? null) !== valores[campo]) cambios[campo] = valores[campo];
    }
    return cambios;
}
