import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/useTheme';
import { useIdioma } from '../context/useIdioma';

/**
 * Botón toggle para alternar rápidamente entre tema claro y tema oscuro.
 */
export function ThemeToggle({ className = '', showLabel = false }) {
  const { t } = useIdioma();
  const { toggleTheme, isDark } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative inline-flex items-center gap-2 rounded-lg border border-border-color p-2 transition-colors hover:border-brand-blue/60 hover:bg-nav-hover focus:outline-none focus:ring-2 focus:ring-brand-blue/30 cursor-pointer ${className}`}
      title={isDark ? t('preferencias.cambiar_a_claro') : t('preferencias.cambiar_a_oscuro')}
      aria-label={isDark ? t('preferencias.cambiar_a_claro') : t('preferencias.cambiar_a_oscuro')}
    >
      {isDark ? (
        <Sun className="h-5 w-5 text-amber-400 transition-transform duration-300 rotate-0 hover:rotate-45" />
      ) : (
        <Moon className="h-5 w-5 text-brand-blue transition-transform duration-300 hover:-rotate-12" />
      )}
      {showLabel && (
        <span className="text-sm font-medium text-text-primary">
          {isDark ? t('preferencias.tema_claro_largo') : t('preferencias.tema_oscuro_largo')}
        </span>
      )}
    </button>
  );
}

export default ThemeToggle;
