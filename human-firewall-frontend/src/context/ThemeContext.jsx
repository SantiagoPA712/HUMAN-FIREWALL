import React, { useState, useEffect, useCallback } from 'react';
import { ThemeContext } from './ThemeContextDef';

const THEME_KEY = 'human_firewall_theme';
const FALLBACK_THEME_KEY = 'theme';

function getSavedTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(THEME_KEY) || localStorage.getItem(FALLBACK_THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch (e) {
    console.warn('No se pudo acceder a localStorage para leer el tema:', e);
  }
  // Requisito 5: Utilizar el tema claro como predeterminado si no existe una preferencia guardada.
  return 'light';
}

function applyThemeToDocument(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const body = document.body;
  root.setAttribute('data-theme', theme);
  if (body) {
    body.setAttribute('data-theme', theme);
  }
  if (theme === 'dark') {
    root.classList.add('dark');
    if (body) body.classList.add('dark');
  } else {
    root.classList.remove('dark');
    if (body) body.classList.remove('dark');
  }
}

// Aplicar inmediatamente al cargar el script para evitar parpadeos
if (typeof window !== 'undefined') {
  applyThemeToDocument(getSavedTheme());
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getSavedTheme);

  const setTheme = useCallback((valueOrFn) => {
    setThemeState((prevTheme) => {
      const resolved = typeof valueOrFn === 'function' ? valueOrFn(prevTheme) : valueOrFn;
      const targetTheme = resolved === 'dark' ? 'dark' : 'light';
      applyThemeToDocument(targetTheme);
      try {
        localStorage.setItem(THEME_KEY, targetTheme);
        localStorage.setItem(FALLBACK_THEME_KEY, targetTheme);
      } catch (e) {
        console.warn('No se pudo guardar la preferencia de tema en localStorage:', e);
      }
      return targetTheme;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, [setTheme]);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const value = {
    theme,
    isDark: theme === 'dark',
    isLight: theme === 'light',
    setTheme,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export default ThemeProvider;
