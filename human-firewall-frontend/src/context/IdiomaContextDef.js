import { createContext } from 'react';

/**
 * Contexto del idioma de la interfaz.
 *
 * Va en su propio archivo, separado del proveedor, por la misma razon que
 * ThemeContextDef: si el objeto del contexto viviera en el .jsx junto al
 * componente, cada recarga en caliente crearia uno nuevo y los componentes ya
 * montados quedarian leyendo el anterior.
 */
export const IdiomaContext = createContext(null);

export default IdiomaContext;
