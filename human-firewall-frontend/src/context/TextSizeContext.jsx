import React, { useState, useEffect, useCallback } from 'react';
import { TextSizeContext } from './TextSizeContextDef';
import {
  TAMANOS_TEXTO,
  CLAVE_TAMANO_TEXTO,
  esTamanoValido,
  leerTamanoGuardado,
  guardarTamano,
  aplicarTamanoAlDocumento,
} from '../lib/tamanoTexto';

// Aplicar antes del primer render, igual que el tema: si no, la pagina se
// pinta un instante en tamano normal y despues "salta".
if (typeof window !== 'undefined') {
  aplicarTamanoAlDocumento(leerTamanoGuardado());
}

/**
 * Tamano de texto de toda la interfaz (HU de tamano de texto).
 *
 * Vive arriba de las rutas en App.jsx, asi que el tamano elegido se mantiene
 * al navegar entre modulos (criterio de aceptacion 5) y se aplica en el
 * momento, sin recargar ni cerrar sesion (criterio de aceptacion 4).
 */
export function TextSizeProvider({ children }) {
  const [textSize, setTextSizeState] = useState(leerTamanoGuardado);

  /**
   * Criterio de aceptacion 8: un valor que no esta en TAMANOS_TEXTO no se
   * aplica ni se guarda; queda el ultimo valido.
   *
   * @returns {boolean} si el valor se acepto
   */
  const setTextSize = useCallback((valor) => {
    if (!esTamanoValido(valor)) {
      console.warn(`Tamaño de texto no permitido: "${valor}". Se mantiene el actual.`);
      return false;
    }
    setTextSizeState(valor);
    guardarTamano(valor);
    return true;
  }, []);

  useEffect(() => {
    aplicarTamanoAlDocumento(textSize);
  }, [textSize]);

  // Otra pestana de la plataforma cambio el tamano: se sigue el cambio para
  // que las dos se vean igual. Un valor adulterado a mano se ignora.
  useEffect(() => {
    const alCambiarEnOtraPestana = (e) => {
      if (e.key === CLAVE_TAMANO_TEXTO && esTamanoValido(e.newValue)) {
        setTextSizeState(e.newValue);
      }
    };
    window.addEventListener('storage', alCambiarEnOtraPestana);
    return () => window.removeEventListener('storage', alCambiarEnOtraPestana);
  }, []);

  const value = {
    textSize,
    setTextSize,
    sizes: TAMANOS_TEXTO,
  };

  return (
    <TextSizeContext.Provider value={value}>
      {children}
    </TextSizeContext.Provider>
  );
}

export default TextSizeProvider;
