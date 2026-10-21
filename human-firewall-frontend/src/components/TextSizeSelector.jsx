import React from 'react';
import { Check } from 'lucide-react';
import { useTextSize } from '../context/useTextSize';
// `t` ya es el nombre del tamano en los map de abajo, asi que la funcion de
// traduccion entra como `traducir` para no taparlo.
import { useIdioma } from '../context/useIdioma';

// Tamano de la "A" de muestra de cada opcion. Va en em para que la muestra
// tambien crezca con la escala elegida y se siga viendo la diferencia.
const MUESTRA = { pequeno: '0.85em', normal: '1.1em', grande: '1.4em' };

/**
 * Selector de tamano de texto (HU de tamano de texto, criterio tecnico 3).
 *
 * - variant="cards": tarjetas con descripcion, para "Perfil y configuracion".
 * - variant="segmented": tres botones compactos, para la barra lateral.
 *
 * Es un grupo de radio: con el teclado se recorre con Tab y se elige con
 * Enter o Espacio, y el lector de pantalla anuncia cual esta activo.
 */
export function TextSizeSelector({ variant = 'cards', className = '' }) {
  const { textSize, setTextSize, sizes } = useTextSize();
  const { t: traducir } = useIdioma();

  if (variant === 'segmented') {
    return (
      <div
        role="radiogroup"
        aria-label={traducir('texto.titulo')}
        className={`inline-flex rounded-lg border border-border-color bg-bg-card p-1 ${className}`}
      >
        {sizes.map((t) => {
          const activo = textSize === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => setTextSize(t.id)}
              title={traducir('texto.muestra', { tamano: traducir(`texto.${t.id}`).toLowerCase() })}
              className={`flex flex-1 items-center justify-center rounded-md px-2 py-1 font-semibold leading-none transition-all cursor-pointer ${
                activo
                  ? 'bg-brand-blue text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-nav-hover'
              }`}
            >
              <span style={{ fontSize: MUESTRA[t.id] }} aria-hidden="true">A</span>
              <span className="sr-only">{traducir(`texto.${t.id}`)}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label={traducir('texto.titulo')} className={`grid grid-ajustable [--ancho-columna:9rem] gap-3 ${className}`}>
      {sizes.map((t) => {
        const activo = textSize === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => setTextSize(t.id)}
            className={`relative flex flex-col items-start rounded-xl border p-3 text-left transition-all duration-200 cursor-pointer ${
              activo
                ? 'border-brand-blue bg-brand-blue/5 shadow-md shadow-brand-blue/10 ring-2 ring-brand-blue/30'
                : 'border-border-color bg-bg-card hover:border-brand-blue/40 hover:bg-nav-hover'
            }`}
          >
            <div className="mb-2 flex w-full items-center justify-between gap-2">
              <span
                className={`font-bold leading-none ${activo ? 'text-brand-blue' : 'text-text-primary'}`}
                style={{ fontSize: MUESTRA[t.id] }}
                aria-hidden="true"
              >
                Aa
              </span>
              {activo && (
                <span className="flex items-center gap-1 rounded-full bg-brand-blue px-2 py-0.5 text-xs font-semibold text-white">
                  <Check className="h-3 w-3" />
                  {traducir('comun.activo')}
                </span>
              )}
            </div>
            <span className="font-bold text-text-primary">{traducir(`texto.${t.id}`)}</span>
            <span className="mt-0.5 text-xs text-text-secondary">{traducir(`texto.${t.id}_desc`)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default TextSizeSelector;
