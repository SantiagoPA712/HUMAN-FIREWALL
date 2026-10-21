import React from 'react';
import { Shield } from 'lucide-react';
import { useIdioma } from '../context/useIdioma';

/**
 * Insignia de nivel con barra de progreso.
 *
 * Mockup 1 de la HU: "tarjeta de perfil con badge de nivel actual
 * (ej. 'Nivel 3 - Intermedio') y barra de progreso hacia el siguiente nivel".
 *
 * Los datos llegan ya calculados desde GET /api/gamification/level/:userId.
 * El componente no deriva nada: si el backend cambia los umbrales, esto
 * refleja el cambio sin tocarse.
 *
 * @param {object|null} nivel     respuesta del endpoint, o null mientras carga
 * @param {boolean}     compacto  version reducida para la cabecera
 */
export function LevelBadge({ nivel, compacto = false }) {
    const { t } = useIdioma();

    if (!nivel) {
        return compacto
            ? <div className="h-12 w-12 animate-pulse rounded-full bg-border-color" />
            : <div className="h-24 animate-pulse rounded-lg bg-border-color" />;
    }

    const {
        nivel_actual, nombre, puntos_actuales, puntos_faltantes,
        puntos_para_siguiente, porcentaje_avance, siguiente_nombre, es_nivel_maximo
    } = nivel;

    if (compacto) {
        return (
            <div className="flex items-center gap-3">
                <div className="text-right">
                    <p className="text-sm text-text-secondary">{t('nivel.nivel_actual')}</p>
                    <p className="font-bold text-brand-light">{nombre}</p>
                </div>
                <div className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-brand-blue bg-bg-card font-bold text-text-primary shadow-sm">
                    {nivel_actual}
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-3 flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-brand-blue bg-brand-blue/10">
                    <Shield className="h-6 w-6 text-brand-blue" />
                </div>
                <div className="min-w-0">
                    {/* Se envuelve en vez de truncarse: con el texto grande
                        (HU de tamano de texto) el truncado dejaba solo "N". */}
                    <h3 className="break-words text-lg font-bold">
                        {t('comun.nivel')} {nivel_actual} – {nombre}
                    </h3>
                    <p className="text-sm text-text-secondary">
                        {t('nivel.puntos_acumulados', { puntos: puntos_actuales })}
                    </p>
                </div>
            </div>

            <div
                className="h-2.5 overflow-hidden rounded-full bg-border-color"
                role="progressbar"
                aria-valuenow={porcentaje_avance}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('nivel.avance_aria', { nivel: nivel_actual })}
            >
                <div
                    className="h-full rounded-full bg-brand-blue transition-all duration-700"
                    style={{ width: `${porcentaje_avance}%` }}
                />
            </div>

            <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-text-secondary">
                <span>{t('nivel.porcentaje', { porcentaje: porcentaje_avance })}</span>
                {es_nivel_maximo
                    ? <span className="text-brand-light">{t('nivel.maximo_alcanzado')}</span>
                    : <span>
                        {t('nivel.faltan_para', {
                            puntos: puntos_faltantes,
                            siguiente: siguiente_nombre,
                            umbral: puntos_para_siguiente
                        })}
                      </span>}
            </div>
        </div>
    );
}

export default LevelBadge;
