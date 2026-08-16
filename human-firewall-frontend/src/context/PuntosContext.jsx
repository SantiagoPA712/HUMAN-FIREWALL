import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api, getUsuarioActual } from '../lib/api';

/**
 * Estado global de puntos: total acumulado y avisos de "+X puntos".
 *
 * Detalle importante del diseño: los puntos se asignan de forma asincrona en
 * el backend (cola de eventos), asi que justo despues de completar una leccion
 * el total todavia puede no estar actualizado. Por eso, al notificar puntos,
 * se refresca varias veces con una espera creciente en lugar de una sola vez.
 */
const PuntosContext = createContext(null);

export function PuntosProvider({ children }) {
    const [total, setTotal] = useState(null);
    const [avisos, setAvisos] = useState([]);
    const siguienteId = useRef(1);

    const usuario = getUsuarioActual();

    const refrescar = useCallback(async () => {
        if (!usuario) return;
        try {
            const { data } = await api.get(`/api/gamification/points/${usuario.id}`, {
                params: { limit: 1 }
            });
            setTotal(data.total_points);
        } catch {
            // Silencioso a proposito: el widget no debe romper la pantalla.
        }
    }, [usuario?.id]);

    useEffect(() => { refrescar(); }, [refrescar]);

    /**
     * Muestra el aviso y va reconsultando el total hasta que el worker
     * procese el evento.
     */
    const notificarPuntos = useCallback((puntos, origen = '') => {
        if (puntos > 0) {
            const id = siguienteId.current++;
            setAvisos((a) => [...a, { id, puntos, origen }]);
            setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4000);
        }
        [0, 1200, 3000].forEach((ms) => setTimeout(refrescar, ms));
    }, [refrescar]);

    return (
        <PuntosContext.Provider value={{ total, refrescar, notificarPuntos }}>
            {children}
            <ContenedorAvisos avisos={avisos} />
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

export function usePuntos() {
    const ctx = useContext(PuntosContext);
    if (!ctx) throw new Error('usePuntos debe usarse dentro de <PuntosProvider>');
    return ctx;
}
