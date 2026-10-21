import React, { useEffect } from 'react';
import { User, X, Shield, Palette, Sparkles, CheckCircle2, Type } from 'lucide-react';
import { ThemeSelector } from './ThemeSelector';
import { TextSizeSelector } from './TextSizeSelector';
import { getUsuarioActual } from '../lib/api';

/**
 * Modal de Perfil y Configuración del Usuario.
 * Permite al empleado visualizar su información de cuenta y personalizar
 * la apariencia de la plataforma mediante el selector de tema claro y oscuro.
 */
export function UserProfileModal({ isOpen, onClose, userName = 'Usuario' }) {
  const usuario = getUsuarioActual();

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const rolLegible = {
    admin: 'Administrador del Sistema',
    security: 'Oficial de Seguridad (CISO)',
    rh: 'Recursos Humanos',
    manager: 'Gerencia / Manager',
    employee: 'Empleado',
  }[usuario?.role] || 'Empleado';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-card-border bg-bg-card p-6 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between border-b border-border-color pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
              <User className="h-6 w-6" />
            </div>
            <div>
              <h3 id="modal-title" className="text-xl font-bold text-text-primary">
                Perfil y Configuración
              </h3>
              <p className="text-xs text-text-secondary">
                Preferencias personales de cuenta y apariencia
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-secondary hover:bg-nav-hover hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Datos del Usuario */}
        <div className="mb-6 rounded-xl border border-border-color bg-bg-deep/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase font-semibold text-text-secondary tracking-wider">
                Cuenta de Usuario
              </p>
              <h4 className="text-lg font-bold text-text-primary mt-0.5">
                {userName}
              </h4>
              <p className="text-xs text-text-secondary">
                ID de empleado: <span className="font-mono text-text-primary">{usuario?.id || '—'}</span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-brand-blue/10 px-3 py-1 text-xs font-semibold text-brand-light border border-brand-blue/20">
              <Shield className="h-3.5 w-3.5 text-brand-blue" />
              {rolLegible}
            </div>
          </div>
        </div>

        {/* Sección: Configuración de Apariencia y Tema */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Palette className="h-5 w-5 text-brand-blue" />
            <h4 className="font-bold text-text-primary text-base">
              Personalización de Apariencia
            </h4>
          </div>
          <p className="text-xs text-text-secondary mb-4">
            Selecciona el tema que mejor se adapte a tu comodidad visual y condiciones de luz. El cambio se aplica de inmediato y se recordará en tus próximas sesiones.
          </p>

          <ThemeSelector variant="cards" />
        </div>

        {/* Seccion: Tamano del texto (HU de tamano de texto) */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Type className="h-5 w-5 text-brand-blue" />
            <h4 className="font-bold text-text-primary text-base">
              Tamaño del texto
            </h4>
          </div>
          <p className="text-xs text-text-secondary mb-4">
            Ajusta el tamaño de los textos de toda la plataforma. Se aplica al instante en todos los módulos y se recordará la próxima vez que ingreses.
          </p>

          <TextSizeSelector variant="cards" />
        </div>

        {/* Pie del Modal */}
        <div className="flex items-center justify-between border-t border-border-color pt-4 text-xs text-text-secondary">
          <div className="flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>Preferencia guardada automáticamente</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-brand-blue text-white font-medium hover:bg-brand-light transition-colors cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

export default UserProfileModal;
