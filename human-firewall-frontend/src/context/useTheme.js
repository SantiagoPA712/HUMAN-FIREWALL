import { useContext } from 'react';
import { ThemeContext } from './ThemeContextDef';

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe ser utilizado dentro de un ThemeProvider');
  }
  return context;
}

export default useTheme;
