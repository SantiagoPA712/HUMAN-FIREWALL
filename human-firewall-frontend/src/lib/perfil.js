/**
 * Reglas del perfil propio del lado del cliente (HU de perfil editable,
 * criterio tecnico 4).
 *
 * Son las mismas que valida el backend en servicios/identidad/domain/usuario.js:
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
 * Devuelve la CLAVE del mensaje y no el mensaje, para que la pantalla lo
 * resuelva con t() en el idioma que este puesto. Las reglas no cambiaron.
 *
 * @returns {{ errores: Record<string,string>, valores: object }}
 *          una clave de mensaje por campo con problema, y los valores
 *          normalizados (telefono e idioma vacios -> null)
 */
export function validarFormulario(formulario) {
    const errores = {};
    const nombre = normalizarNombre(formulario.full_name || '');

    if (nombre === '') {
        errores.full_name = 'perfil.error_nombre_obligatorio';
    } else if (nombre.length < 2 || nombre.length > 150) {
        errores.full_name = 'perfil.error_nombre_largo';
    } else if (!FORMATO_NOMBRE.test(nombre)) {
        errores.full_name = 'perfil.error_nombre_formato';
    }

    const telefono = normalizarTelefono(formulario.phone || '');
    if (telefono !== '' && !FORMATO_TELEFONO.test(telefono)) {
        errores.phone = 'perfil.error_telefono';
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
