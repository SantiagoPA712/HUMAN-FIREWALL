import React from 'react';
import { Trophy } from 'lucide-react';
import { usePuntos } from '../context/PuntosContext';
import { useIdioma } from '../context/useIdioma';

/**
 * Indicador de puntos totales. Se alimenta del contexto, asi que se actualiza
 * solo cuando alguna accion otorga puntos.
 */
export function PointsWidget({ compacto = false }) {
    const { total } = usePuntos();
    const { t, idioma } = useIdioma();

    if (compacto) {
        return (
            <a
                href="/points"
                className="flex items-center gap-2 rounded-lg border border-border-color bg-bg-card/40 px-3 py-2 transition-colors hover:border-brand-blue/60"
                title={t('nivel.ver_historial_titulo')}
            >
                <Trophy className="h-4 w-4 text-brand-blue" />
                <span className="font-bold text-text-primary">
                    {total === null ? '—' : total.toLocaleString(idioma)}
                </span>
                <span className="text-xs text-text-secondary">pts</span>
            </a>
        );
    }

    return (
        <div>
            <h3 className="mb-2 text-lg font-bold">{t('nivel.puntos_seguridad')}</h3>
            <div className="flex flex-wrap items-baseline gap-x-1 text-4xl font-black text-brand-blue">
                {total === null ? '—' : total.toLocaleString(idioma)}
                <span className="text-lg text-text-secondary">pts</span>
            </div>
            <a href="/points" className="mt-2 inline-block text-sm text-brand-light hover:underline">
                {t('nivel.ver_historial')}
            </a>
        </div>
    );
}

export default PointsWidget;
