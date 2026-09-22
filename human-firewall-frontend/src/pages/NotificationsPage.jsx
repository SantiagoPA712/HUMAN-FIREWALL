import React, { useCallback, useEffect, useState } from 'react';
import {
    Bell, ArrowLeft, CheckCheck, RotateCcw, BookOpen, Mail, Monitor,
    ShieldAlert, RefreshCw, CheckCircle2, XCircle
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { api, getUsuarioActual } from '../lib/api';

/**
 * Centro de notificaciones de resultados.
 *
 * Criterio de aceptacion 3: listado cronologico de resultados notificados,
 * marcados como leidos o no leidos, y un boton para marcar todas de una vez.
 *
 * Tres bloques:
 *   - la lista de resultados, con sus opciones de reintento cuando reprobo,
 *   - los canales que el usuario tiene habilitados (criterio tecnico 3),
 *   - y, solo para RH, que cursos disparan alerta (criterio de aceptacion 2).
 *
 * La pantalla no decide nada: no sabe que es un curso critico ni a quien se
 * le avisa. Pide y dibuja; la resolucion de destinatarios vive en el backend,
 * como exige el criterio tecnico 2.
 */
export default function NotificationsPage() {
    const usuario = getUsuarioActual();
    const esRh = usuario?.role === 'rh' || usuario?.role === 'admin';

    const [centro, setCentro] = useState(null);
    const [preferencias, setPreferencias] = useState(null);
    const [cursos, setCursos] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);

        try {
            // Se piden por separado para que un fallo en la parte de RH no
            // deje sin bandeja al usuario.
            const [resCentro, resPrefs] = await Promise.all([
                api.get('/api/notifications/resultados'),
                api.get('/api/notifications/preferencias')
            ]);
            setCentro(resCentro.data);
            setPreferencias(resPrefs.data.canales);

            if (esRh) {
                const { data } = await api.get('/api/notifications/cursos-criticos');
                setCursos(data);
            }
        } catch (e) {
            setError(e.response?.data?.msg || 'No se pudieron cargar las notificaciones');
        } finally {
            setCargando(false);
        }
    }, [esRh]);

    useEffect(() => {
        if (!usuario) window.location.href = '/login';
    }, [usuario]);

    /* eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
    useEffect(() => { cargar(); }, []);

    const marcarTodas = async () => {
        try {
            await api.patch('/api/notifications/leidas');
            cargar();
        } catch {
            setError('No se pudieron marcar como leídas');
        }
    };

    const cambiarCanal = async (canal, valor) => {
        try {
            const { data } = await api.patch('/api/notifications/preferencias', { [canal]: valor });
            setPreferencias(data.canales);
        } catch {
            setError('No se pudo guardar la preferencia');
        }
    };

    const cambiarCritico = async (curso) => {
        try {
            await api.patch(`/api/notifications/cursos-criticos/${curso.id}`, {
                is_critical: !curso.is_critical
            });
            const { data } = await api.get('/api/notifications/cursos-criticos');
            setCursos(data);
        } catch {
            setError('No se pudo actualizar el curso');
        }
    };

    const fecha = (iso) =>
        iso ? new Date(iso).toLocaleString('es', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : '';

    return (
        <Marco>
            {error && (
                <Card className="mb-6 border-l-4 border-l-red-500 p-4">
                    <p className="text-red-400">{error}</p>
                </Card>
            )}

            {/* --- Canales (criterio tecnico 3) --- */}
            <Card className="mb-6 p-6">
                <h2 className="mb-1 flex items-center gap-2 font-bold">
                    <Monitor className="h-5 w-5 text-brand-blue" /> Cómo querés recibir los avisos
                </h2>
                <p className="mb-4 text-sm text-text-secondary">
                    Cada canal se entrega y se marca como leído por separado.
                </p>

                <div className="flex flex-wrap gap-3">
                    <Canal
                        icono={<Monitor className="h-4 w-4" />}
                        etiqueta="En la aplicación"
                        activo={preferencias?.in_app !== false}
                        onClick={() => cambiarCanal('in_app', preferencias?.in_app === false)}
                    />
                    <Canal
                        icono={<Mail className="h-4 w-4" />}
                        etiqueta="Correo"
                        activo={preferencias?.email !== false}
                        onClick={() => cambiarCanal('email', preferencias?.email === false)}
                    />
                </div>
            </Card>

            {/* --- Cursos criticos: solo RH (criterio de aceptacion 2) --- */}
            {esRh && cursos && (
                <Card className="mb-6 p-6">
                    <h2 className="mb-1 flex items-center gap-2 font-bold">
                        <ShieldAlert className="h-5 w-5 text-brand-blue" /> Cursos críticos
                    </h2>
                    <p className="mb-4 text-sm text-text-secondary">
                        Cuando alguien de tu equipo complete o repruebe uno de estos cursos, te llega
                        una alerta. {cursos.criticos} de {cursos.total} marcados.
                    </p>

                    <div className="space-y-2">
                        {cursos.cursos.map(c => (
                            <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2">
                                <span className="flex items-center gap-2 text-sm">
                                    <BookOpen className="h-4 w-4 text-text-secondary" />
                                    {c.title}
                                </span>
                                <button
                                    onClick={() => cambiarCritico(c)}
                                    className={`rounded-full border px-3 py-1 text-xs ${
                                        c.is_critical
                                            ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                                            : 'border-gray-700 text-text-secondary'
                                    }`}
                                >
                                    {c.is_critical ? 'Crítico' : 'Normal'}
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* --- Listado cronologico (criterio de aceptacion 3) --- */}
            <Card className="p-6">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-bold">
                        Resultados
                        {centro?.no_leidas > 0 && (
                            <span className="ml-2 rounded-full bg-brand-blue px-2 py-0.5 text-xs font-semibold text-white">
                                {centro.no_leidas} sin leer
                            </span>
                        )}
                    </h2>

                    <div className="flex items-center gap-3">
                        <button onClick={cargar} disabled={cargando}
                                className="flex items-center gap-2 text-sm text-text-secondary hover:text-white disabled:opacity-50">
                            <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
                            Actualizar
                        </button>
                        <Button onClick={marcarTodas} className="px-3 py-1.5 text-sm"
                                disabled={!centro || centro.no_leidas === 0}>
                            <CheckCheck className="h-4 w-4" />
                            Marcar todas como leídas
                        </Button>
                    </div>
                </div>

                {!centro ? (
                    <p className="py-8 text-center text-sm text-text-secondary">Cargando…</p>
                ) : centro.resultados.length === 0 ? (
                    <div className="py-12 text-center">
                        <Bell className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                        <p className="font-semibold">Todavía no tenés resultados notificados</p>
                        <p className="mt-1 text-sm text-text-secondary">
                            Acá van a aparecer tus evaluaciones, simulaciones y cursos terminados.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {centro.resultados.map(n => <Aviso key={n.id} n={n} fecha={fecha} />)}
                    </div>
                )}
            </Card>
        </Marco>
    );
}

/** Una notificacion, con su estado por canal y sus opciones de reintento. */
function Aviso({ n, fecha }) {
    // El estado de lectura sale de la entrega in_app, no del campo global del
    // aviso: el correo se marca leido por su cuenta (criterio tecnico 3).
    const leida = !!n.leida_en_app;
    const reprobado = n.payload?.resultado === 'reprobado' || n.payload?.resultado === 'reprobada';

    return (
        <div className={`rounded-xl border p-4 ${
            leida ? 'border-gray-800' : 'border-brand-blue/40 bg-brand-blue/5'
        }`}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    {reprobado
                        ? <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                        : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />}
                    <div>
                        <p className={`font-semibold ${leida ? '' : 'text-brand-light'}`}>{n.title}</p>
                        {/* El cuerpo trae saltos de linea del servidor. */}
                        <p className="mt-1 whitespace-pre-line text-sm text-text-secondary">{n.body}</p>
                    </div>
                </div>

                <div className="shrink-0 text-right">
                    <p className="text-xs text-text-secondary">{fecha(n.created_at)}</p>
                    {!leida && (
                        <span className="mt-1 inline-block rounded bg-brand-blue/20 px-2 py-0.5 text-[11px] font-semibold text-brand-light">
                            Sin leer
                        </span>
                    )}
                </div>
            </div>

            {/* Criterio de aceptacion 1: si reprobo, las opciones para reintentar. */}
            {reprobado && (n.payload?.reintentar_en || n.payload?.reforzar_en) && (
                <div className="mt-3 flex flex-wrap gap-2 pl-8">
                    {n.payload.reintentar_en && (
                        <a href={n.payload.reintentar_en}
                           className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs hover:bg-gray-800">
                            <RotateCcw className="h-3.5 w-3.5" /> Reintentar
                        </a>
                    )}
                    {n.payload.reforzar_en && (
                        <a href={n.payload.reforzar_en}
                           className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs hover:bg-gray-800">
                            <BookOpen className="h-3.5 w-3.5" /> Ver refuerzos
                        </a>
                    )}
                </div>
            )}

            {/* Estado por canal (criterios tecnicos 3 y 5). */}
            {n.canales?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 pl-8">
                    {n.canales.map(c => (
                        <span key={c.canal}
                              className="inline-flex items-center gap-1 rounded border border-gray-800 px-2 py-0.5 font-mono text-[11px] text-text-secondary">
                            {c.canal === 'email' ? <Mail className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                            {c.canal} · {c.estado}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function Canal({ icono, etiqueta, activo, onClick }) {
    return (
        <button onClick={onClick}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${
                    activo
                        ? 'border-brand-blue bg-brand-blue/15 text-brand-light'
                        : 'border-gray-700 text-text-secondary'
                }`}>
            {icono}
            {etiqueta}
            <span className="text-xs">{activo ? '· activado' : '· desactivado'}</span>
        </button>
    );
}

function Marco({ children }) {
    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-4xl">
                <a href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-text-secondary hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> Volver al panel
                </a>
                <header className="mb-8">
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <Bell className="h-8 w-8 text-brand-blue" />
                        Centro de notificaciones
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        Resultados de tus evaluaciones, simulaciones y cursos.
                    </p>
                </header>
                {children}
            </div>
        </div>
    );
}
