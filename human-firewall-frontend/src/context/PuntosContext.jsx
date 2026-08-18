import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Award, X, Shield } from 'lucide-react';
import { api, getUsuarioActual } from '../lib/api';

/**
 * Estado global de gamificacion: puntos, avisos de "+X puntos" y recompensas.
 *
 * Detalle importante del diseño: tanto los puntos como las recompensas se
 * asignan de forma asincrona en el backend (cola de eventos), asi que justo
 * despues de completar una leccion los datos todavia pueden no estar listos.
 * Por eso se refresca varias veces con espera creciente en vez de una sola.
 */
const PuntosContext = createContext(null);

export function PuntosProvider({ children }) {
    const [total, setTotal] = useState(null);
    const [recompensas, setRecompensas] = useState([]);
    const [nivel, setNivel] = useState(null);
    const [avisos, setAvisos] = useState([]);
    const [nuevaRecompensa, setNuevaRecompensa] = useState(null);
    const [subidaNivel, setSubidaNivel] = useState(null);

    const siguienteId = useRef(1);
    const idsConocidos = useRef(null);   // null = todavia no se cargo nada
    const nivelConocido = useRef(null);

    const usuario = getUsuarioActual();
    const userId = usuario?.id;

    const refrescar = useCallback(async () => {
        if (!userId) return;

        try {
            const [puntos, logros, nivelResp] = await Promise.all([
                api.get(`/api/gamification/points/${userId}`, { params: { limit: 1 } }),
                api.get(`/api/gamification/rewards/${userId}`),
                api.get(`/api/gamification/level/${userId}`)
            ]);

            setTotal(puntos.data.total_points);
            setNivel(nivelResp.data);

            const obtenidas = logros.data.obtenidas || [];
            setRecompensas(obtenidas);

            const ids = new Set(obtenidas.map(r => r.id));
            const nivelActual = nivelResp.data.nivel_actual;

            // En la primera carga solo se memoriza: no tiene sentido celebrar
            // recompensas ni niveles que el usuario ya tenia de antes.
            if (idsConocidos.current === null) {
                idsConocidos.current = ids;
                nivelConocido.current = nivelActual;
                return;
            }

            const recien = obtenidas.find(r => !idsConocidos.current.has(r.id));
            idsConocidos.current = ids;
            if (recien) setNuevaRecompensa(recien);

            // Criterio de aceptacion 2: indicador de que subio de nivel.
            // Solo cuando sube: si bajara por una correccion de umbrales, no
            // hay nada que festejar.
            if (nivelConocido.current != null && nivelActual > nivelConocido.current) {
                setSubidaNivel(nivelResp.data);
            }
            nivelConocido.current = nivelActual;

        } catch {
            // Silencioso a proposito: un fallo aca no debe romper la pantalla.
        }
    }, [userId]);

    useEffect(() => { refrescar(); }, [refrescar]);

    const notificarPuntos = useCallback((puntos, origen = '') => {
        if (puntos > 0) {
            const id = siguienteId.current++;
            setAvisos((a) => [...a, { id, puntos, origen }]);
            setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4000);
        }
        [0, 1200, 3000].forEach((ms) => setTimeout(refrescar, ms));
    }, [refrescar]);

    return (
        <PuntosContext.Provider value={{ total, recompensas, nivel, refrescar, notificarPuntos }}>
            {children}
            <ContenedorAvisos avisos={avisos} />
            <ModalRecompensa
                recompensa={nuevaRecompensa}
                onCerrar={() => setNuevaRecompensa(null)}
            />
            <ModalSubidaNivel
                nivel={subidaNivel}
                onCerrar={() => setSubidaNivel(null)}
            />
        </PuntosContext.Provider>
    );
}

/** Avisos flotantes de puntos ganados. */
function ContenedorAvisos({ avisos }) {
    if (avisos.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3" role="status" aria-live="polite">
            {avisos.map((a) => (
                <div
                    key={a.id}
                    className="flex items-center gap-3 rounded-xl border border-brand-blue/40 bg-bg-deep/95 px-5 py-3 shadow-lg shadow-brand-blue/20 backdrop-blur"
                >
                    <span className="text-2xl font-black text-brand-blue">+{a.puntos}</span>
                    <div className="leading-tight">
                        <p className="font-semibold text-text-primary">puntos ganados</p>
                        {a.origen && <p className="text-xs text-text-secondary">{a.origen}</p>}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Modal de "nueva recompensa desbloqueada". */
function ModalRecompensa({ recompensa, onCerrar }) {
    if (!recompensa) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={onCerrar}
        >
            <div
                className="relative w-full max-w-sm rounded-2xl border border-brand-blue/40 bg-bg-deep p-8 text-center shadow-2xl shadow-brand-blue/30"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onCerrar}
                    className="absolute right-4 top-4 text-text-secondary hover:text-white"
                    aria-label="Cerrar"
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-2 border-brand-blue bg-brand-blue/10">
                    {recompensa.reward_icon_url
                        ? <img src={recompensa.reward_icon_url} alt="" className="h-12 w-12" />
                        : <Award className="h-10 w-10 text-brand-blue" />}
                </div>

                <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-brand-light">
                    ¡Nueva recompensa desbloqueada!
                </p>
                <h2 className="mb-2 text-2xl font-bold text-text-primary">
                    {recompensa.reward_name}
                </h2>
                {recompensa.reward_description && (
                    <p className="mb-6 text-sm text-text-secondary">{recompensa.reward_description}</p>
                )}

                <a
                    href="/rewards"
                    className="inline-block w-full rounded-lg bg-brand-blue px-4 py-3 font-semibold text-white transition-colors hover:bg-brand-light"
                >
                    Ver mis logros
                </a>
            </div>
        </div>
    );
}

/**
 * Pantalla de "subiste de nivel".
 * Mockup 3 de la HU de niveles.
 */
function ModalSubidaNivel({ nivel, onCerrar }) {
    if (!nivel) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={onCerrar}
        >
            <div
                className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-brand-blue/50 bg-gradient-to-b from-brand-dark/60 to-bg-deep p-8 text-center shadow-2xl shadow-brand-blue/40"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onCerrar}
                    className="absolute right-4 top-4 text-text-secondary hover:text-white"
                    aria-label="Cerrar"
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="mx-auto mb-5 flex h-24 w-24 animate-bounce items-center justify-center rounded-full border-4 border-brand-blue bg-brand-blue/20">
                    <span className="text-3xl font-black text-brand-light">{nivel.nivel_actual}</span>
                </div>

                <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-brand-light">
                    ¡Subiste de nivel!
                </p>
                <h2 className="mb-2 flex items-center justify-center gap-2 text-2xl font-bold text-text-primary">
                    <Shield className="h-6 w-6 text-brand-blue" />
                    {nivel.nombre}
                </h2>
                {nivel.descripcion && (
                    <p className="mb-4 text-sm text-text-secondary">{nivel.descripcion}</p>
                )}

                <p className="mb-6 text-sm text-text-secondary">
                    {nivel.es_nivel_maximo
                        ? 'Llegaste al nivel más alto de la plataforma.'
                        : <>Te faltan <strong className="text-brand-light">{nivel.puntos_faltantes}</strong> puntos para {nivel.siguiente_nombre}.</>}
                </p>

                <a
                    href="/level"
                    className="inline-block w-full rounded-lg bg-brand-blue px-4 py-3 font-semibold text-white transition-colors hover:bg-brand-light"
                >
                    Ver mi nivel
                </a>
            </div>
        </div>
    );
}

export function usePuntos() {
    const ctx = useContext(PuntosContext);
    if (!ctx) throw new Error('usePuntos debe usarse dentro de <PuntosProvider>');
    return ctx;
}
