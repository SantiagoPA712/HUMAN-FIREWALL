import { useContext } from 'react';
import { IdiomaContext } from './IdiomaContextDef';

/**
 * Acceso al idioma y a `t()` desde cualquier componente.
 *
 * Mismo contrato que useTheme: si alguien lo usa fuera del proveedor,
 * revienta con un mensaje claro en vez de devolver undefined y romper mas
 * adelante en una linea que no tiene nada que ver.
 */
export function useIdioma() {
    const contexto = useContext(IdiomaContext);
    if (!contexto) {
        throw new Error('useIdioma debe usarse dentro de un IdiomaProvider');
    }
    return contexto;
}

/** Atajo para cuando el componente solo necesita traducir. */
export function useT() {
    return useIdioma().t;
}

export default useIdioma;
