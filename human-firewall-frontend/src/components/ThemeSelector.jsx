import React from 'react';
import { Sun, Moon, Check } from 'lucide-react';
import { useTheme } from '../context/useTheme';
import { useIdioma } from '../context/useIdioma';

/**
 * Selector de tema claro y oscuro con tarjetas interactivas e indicadores de estado.
 * Diseñado especialmente para la sección de Configuración y Perfil de Usuario.
 */
export function ThemeSelector({ variant = 'cards', className = '' }) {
  const { t } = useIdioma();
  const { setTheme, isDark, isLight } = useTheme();

  if (variant === 'segmented') {
    return (
      <div className={`inline-flex rounded-lg border border-border-color bg-bg-card p-1 ${className}`}>
        <button
          type="button"
          onClick={() => setTheme('light')}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all cursor-pointer ${
            isLight
              ? 'bg-brand-blue text-white shadow-sm'
              : 'text-text-secondary hover:text-text-primary hover:bg-nav-hover'
          }`}
          aria-pressed={isLight}
        >
          <Sun className="h-4 w-4" />
          {t('preferencias.tema_claro')}
        </button>
        <button
          type="button"
          onClick={() => setTheme('dark')}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all cursor-pointer ${
            isDark
              ? 'bg-brand-blue text-white shadow-sm'
              : 'text-text-secondary hover:text-text-primary hover:bg-nav-hover'
          }`}
          aria-pressed={isDark}
        >
          <Moon className="h-4 w-4" />
          {t('preferencias.tema_oscuro')}
        </button>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${className}`}>
      {/* Opción Tema Claro */}
      <button
        type="button"
        onClick={() => setTheme('light')}
        className={`group relative flex flex-col items-start p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
          isLight
            ? 'border-brand-blue bg-brand-blue/5 shadow-md shadow-brand-blue/10 ring-2 ring-brand-blue/30'
            : 'border-border-color bg-bg-card hover:border-brand-blue/40 hover:bg-nav-hover'
        }`}
        aria-pressed={isLight}
      >
        <div className="flex w-full items-center justify-between mb-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
            isLight
              ? 'bg-brand-blue text-white border-brand-blue'
              : 'bg-bg-deep text-amber-500 border-border-color'
          }`}>
            <Sun className="h-5 w-5" />
          </div>
          {isLight && (
            <span className="flex items-center gap-1 rounded-full bg-brand-blue text-white px-2.5 py-0.5 text-xs font-semibold">
              <Check className="h-3 w-3" />
              {t('comun.activo')}
            </span>
          )}
        </div>
        <div>
          <h4 className="font-bold text-text-primary flex items-center gap-2">
            {t('preferencias.tema_claro_largo')}
            <span className="text-3xs font-normal uppercase tracking-wider text-text-secondary border border-border-color rounded px-1.5 py-0.2">
              Predeterminado
            </span>
          </h4>
          <p className="mt-1 text-xs text-text-secondary">
            Interfaz luminosa de alto contraste, ideal para entornos de trabajo bien iluminados.
          </p>
        </div>
      </button>

      {/* Opción Tema Oscuro */}
      <button
        type="button"
        onClick={() => setTheme('dark')}
        className={`group relative flex flex-col items-start p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
          isDark
            ? 'border-brand-blue bg-brand-blue/5 shadow-md shadow-brand-blue/10 ring-2 ring-brand-blue/30'
            : 'border-border-color bg-bg-card hover:border-brand-blue/40 hover:bg-nav-hover'
        }`}
        aria-pressed={isDark}
      >
        <div className="flex w-full items-center justify-between mb-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
            isDark
              ? 'bg-brand-blue text-white border-brand-blue'
              : 'bg-bg-deep text-brand-light border-border-color'
          }`}>
            <Moon className="h-5 w-5" />
          </div>
          {isDark && (
            <span className="flex items-center gap-1 rounded-full bg-brand-blue text-white px-2.5 py-0.5 text-xs font-semibold">
              <Check className="h-3 w-3" />
              {t('comun.activo')}
            </span>
          )}
        </div>
        <div>
          <h4 className="font-bold text-text-primary">
            {t('preferencias.tema_oscuro_largo')}
          </h4>
          <p className="mt-1 text-xs text-text-secondary">
            Colores profundos diseñados para reducir la fatiga visual en sesiones prolongadas.
          </p>
        </div>
      </button>
    </div>
  );
}

export default ThemeSelector;
