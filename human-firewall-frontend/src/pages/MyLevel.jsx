import React, { useEffect, useState } from 'react';
import { ShieldCheck, ArrowLeft, Shield, Check, Lock } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { LevelBadge } from '../components/LevelBadge';
import { api, getUsuarioActual } from '../lib/api';

/**
 * Vista ampliada "Mi nivel" (mockup 2 de la HU):
 * puntos actuales, puntos que faltan para subir e historial de niveles
 * alcanzados.
 *
 * Muestra ademas la escalera completa, para que se vea a donde lleva el
 * camino. Los umbrales salen de GET /levels, nunca hardcodeados: si manana
 * cambian en la base, esta pantalla los refleja sola.
 */
export default function MyLevel() {
    const [nivel, setNivel] = useState(null);
    const [escalera, setEscalera] = useState([]);
    const [error, setError] = useState(null);
    const usuario = getUsuarioActual();

    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }

        Promise.all([
            api.get(`/api/gamification/level/${usuario.id}`),
            api.get('/api/gamification/levels')
        ])
            .then(([nivelResp, escaleraResp]) => {
                setNivel(nivelResp.data);
                setEscalera(escaleraResp.data);
                setError(null);
            })
            .catch((e) => setError(e.response?.data?.msg || 'No se pudo cargar tu nivel'));
    }, [usuario?.id]);

    const formatearFecha = (iso) =>
        new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' });

    const alcanzados = new Set((nivel?.historial || []).map((h) => h.level));

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-4xl">
                <a href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-text-secondary hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> Volver al panel
                </a>

                <header className="mb-8">
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <ShieldCheck className="h-8 w-8 text-brand-blue" />
                        Mi nivel
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        Tu nivel sale de los puntos que acumulaste. Cuanto más entrenás, más alto llegás.
                    </p>
                </header>

                {error && (
                    <Card className="border-l-4 border-l-red-500 p-6">
                        <p className="text-red-400">{error}</p>
                    </Card>
                )}
                {!error && !nivel && <p className="text-text-secondary">Cargando…</p>}

                {nivel && (
                    <>
                        <Card className="mb-8 p-8">
                            <LevelBadge nivel={nivel} />
                        </Card>

                        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <Card className="p-6">
                                <p className="text-sm text-text-secondary">Puntos actuales</p>
                                <p className="text-3xl font-black text-brand-blue">{nivel.puntos_actuales}</p>
                            </Card>
                            <Card className="p-6">
                                <p className="text-sm text-text-secondary">
                                    {nivel.es_nivel_maximo ? 'Estado' : 'Faltan para subir'}
                                </p>
                                <p className="text-3xl font-black">
                                    {nivel.es_nivel_maximo ? '—' : nivel.puntos_faltantes}
                                </p>
                            </Card>
                            <Card className="p-6">
                                <p className="text-sm text-text-secondary">Niveles alcanzados</p>
                                <p className="text-3xl font-black text-brand-light">{nivel.historial.length}</p>
                            </Card>
                        </div>

                        <h2 className="mb-4 text-xl font-bold">La escalera completa</h2>
                        <div className="mb-10 space-y-3">
                            {escalera.map((n) => {
                                const esActual = n.level === nivel.nivel_actual;
                                const logrado = alcanzados.has(n.level);

                                return (
                                    <Card
                                        key={n.level}
                                        className={`flex items-center gap-4 p-5 ${
                                            esActual ? 'border-l-4 border-l-brand-blue' : logrado ? '' : 'opacity-60'
                                        }`}
                                    >
                                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 ${
                                            logrado
                                                ? 'border-brand-blue bg-brand-blue/10 text-brand-light'
                                                : 'border-gray-700 bg-gray-800 text-text-secondary'
                                        }`}>
                                            {logrado ? <Check className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <h3 className="font-bold">
                                                Nivel {n.level} – {n.name}
                                                {esActual && (
                                                    <span className="ml-2 rounded-full bg-brand-blue/20 px-2 py-0.5 text-xs font-semibold text-brand-light">
                                                        estás acá
                                                    </span>
                                                )}
                                            </h3>
                                            {n.description && (
                                                <p className="text-sm text-text-secondary">{n.description}</p>
                                            )}
                                        </div>

                                        <div className="shrink-0 text-right">
                                            <p className="text-xs text-text-secondary">desde</p>
                                            <p className="font-mono font-bold">{n.min_points} pts</p>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>

                        <h2 className="mb-4 text-xl font-bold">Historial de niveles alcanzados</h2>
                        {nivel.historial.length === 0 ? (
                            <Card className="p-8 text-center">
                                <p className="text-text-secondary">Todavía no hay registros.</p>
                            </Card>
                        ) : (
                            <Card className="divide-y divide-gray-800 p-0">
                                {nivel.historial.map((h) => (
                                    <div key={h.level} className="flex items-center gap-4 p-5">
                                        <Shield className="h-5 w-5 shrink-0 text-brand-blue" />
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold">
                                                Nivel {h.level} – {h.level_name}
                                            </p>
                                            <p className="text-xs text-text-secondary">
                                                Alcanzado el {formatearFecha(h.reached_at)} con {h.points_at} puntos
                                            </p>
                                        </div>
                                        <span className="shrink-0 font-mono text-sm text-text-secondary">
                                            {h.min_points} pts
                                        </span>
                                    </div>
                                ))}
                            </Card>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
