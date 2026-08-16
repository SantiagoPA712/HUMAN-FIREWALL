import React from 'react';
import { Trophy } from 'lucide-react';
import { usePuntos } from '../context/PuntosContext';

/**
 * Indicador de puntos totales. Se alimenta del contexto, asi que se actualiza
 * solo cuando alguna accion otorga puntos.
 */
export function PointsWidget({ compacto = false }) {
    const { total } = usePuntos();

    if (compacto) {
        return (
            <a
                href="/points"
                className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 transition-colors hover:border-brand-blue/60"
                title="Ver historial de puntos"
            >
                <Trophy className="h-4 w-4 text-brand-blue" />
                <span className="font-bold text-text-primary">
                    {total === null ? '—' : total.toLocaleString('es')}
                </span>
                <span className="text-xs text-text-secondary">pts</span>
            </a>
        );
    }

    return (
        <div>
            <h3 className="mb-2 text-lg font-bold">Puntos de Seguridad</h3>
            <div className="text-4xl font-black text-brand-blue">
                {total === null ? '—' : total.toLocaleString('es')}
                <span className="ml-1 text-lg text-text-secondary">pts</span>
            </div>
            <a href="/points" className="mt-2 inline-block text-sm text-brand-light hover:underline">
                Ver historial
            </a>
        </div>
    );
}

export default PointsWidget;
