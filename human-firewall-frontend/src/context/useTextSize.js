import { useContext } from 'react';
import { TextSizeContext } from './TextSizeContextDef';

export function useTextSize() {
  const context = useContext(TextSizeContext);
  if (!context) {
    throw new Error('useTextSize debe ser utilizado dentro de un TextSizeProvider');
  }
  return context;
}

export default useTextSize;
