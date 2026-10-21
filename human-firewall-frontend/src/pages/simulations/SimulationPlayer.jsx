import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
    ShieldCheck, ArrowLeft, CheckCircle, XCircle, Target, Trophy, RotateCcw
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { usePuntos } from '../../context/PuntosContext';
import { useIdioma } from '../../context/useIdioma';

/**
 * Reproductor de simulaciones guiadas.
 *
 * Los cinco minijuegos del portal (phishing, wifi, etc.) son pantallas React
 * con su escenario escrito a mano en el propio componente: agregar una nueva
 * exige programar. Esta pantalla es lo contrario: recorre una simulacion
 * cargada en la base (simulations -> simulation_steps -> simulation_options),
 * asi que un instructor puede crear escenarios nuevos desde la API sin que
 * nadie toque el codigo.
 *
 * Toda esa maquinaria existia en el backend desde el principio y no habia
 * ninguna pantalla que la usara, de modo que una simulacion creada por un
 * instructor era inalcanzable para el empleado.
 *
 * Flujo: un paso a la vez -> el usuario elige -> el backend responde si acerto
 * y con que retroalimentacion -> al terminar se cierra el intento y queda en
 * el historial de desempeno.
 */
export default function SimulationPlayer() {
    const { id } = useParams();
    const { t } = useIdioma();
    const { notificarPuntos, refrescar } = usePuntos();

    const [simulacion, setSimulacion] = useState(null);
    const [error, setError] = useState(null);

    const [pasoActual, setPasoActual] = useState(0);
    const [respuesta, setRespuesta] = useState(null);   // feedback del paso en curso
    const [elegidas, setElegidas] = useState([]);       // ids de opcion, para el cierre
    const [resultado, setResultado] = useState(null);   // resumen final
    const [enviando, setEnviando] = useState(false);

    useEffect(() => {
        api.get(`/api/simulations/${id}`)
            .then(({ data }) => {
                // Los pasos vienen ordenados por order_idx desde el backend.
                setSimulacion(data);
                setError(null);
            })
            .catch((e) => setError(e.response?.data?.msg || t('juegos.sp_error_cargar')));
    }, [id, t]);

    const pasos = simulacion?.steps || [];
    const paso = pasos[pasoActual];
    const esUltimo = pasoActual === pasos.length - 1;

    /** Envia la opcion elegida y muestra la retroalimentacion del backend. */
    const elegir = async (opcion) => {
        if (respuesta || enviando) return;   // ya respondio este paso
        setEnviando(true);

        try {
            const { data } = await api.post('/api/simulations/submit-decision', {
                optionId: opcion.id
            });

            setRespuesta(data);
            setElegidas((prev) => [...prev, opcion.id]);

            // Los puntos ya no se otorgan dentro de esta llamada: el backend
            // publica simulation.decision_made y responde. Lo que llega es el
            // estimado, igual que en los minijuegos del portal. El saldo real
            // se refresca al cerrar la simulacion, cuando el worker ya proceso
            // la cola.
            if (data.puntos_estimados > 0) {
                notificarPuntos(data.puntos_estimados, simulacion.title);
            }
        } catch (e) {
            setError(e.response?.data?.msg || t('juegos.sp_error_decision'));
        } finally {
            setEnviando(false);
        }
    };

    /** Avanza al paso siguiente o cierra la simulacion. */
    const continuar = async () => {
        if (!esUltimo) {
            setPasoActual((n) => n + 1);
            setRespuesta(null);
            return;
        }

        setEnviando(true);
        try {
            // El puntaje lo calcula el servidor con las opciones elegidas: si
            // lo mandara esta pantalla, cualquiera podria aprobar sin jugar.
            const { data } = await api.post(`/api/simulations/${id}/complete`, {
                decisiones: elegidas
            });
            setResultado(data);
            refrescar();
        } catch (e) {
            setError(e.response?.data?.msg || t('juegos.sp_error_cerrar'));
        } finally {
            setEnviando(false);
        }
    };

    const reiniciar = () => {
        setPasoActual(0);
        setRespuesta(null);
        setElegidas([]);
        setResultado(null);
    };

    // -----------------------------------------------------------------
    if (error) {
        return (
            <Pantalla>
                <Card className="border-l-4 border-l-red-500 p-6">
                    <p className="text-red-400">{error}</p>
                    <a href="/challenges" className="mt-4 inline-block text-brand-light hover:underline">
                        {t('juegos.sp_volver_desafios')}
                    </a>
                </Card>
            </Pantalla>
        );
    }

    if (!simulacion) {
        return <Pantalla><p className="text-text-secondary">{t('juegos.sp_cargando')}</p></Pantalla>;
    }

    if (pasos.length === 0) {
        return (
            <Pantalla>
                <Card className="p-8 text-center">
                    <p className="font-semibold">{t('juegos.sp_sin_pasos')}</p>
                    <p className="mt-1 text-sm text-text-secondary">
                        {t('juegos.sp_sin_pasos_ayuda')}
                    </p>
                </Card>
            </Pantalla>
        );
    }

    // Resumen final -----------------------------------------------------
    if (resultado) {
        const aprobada = resultado.aprobada;
        return (
            <Pantalla>
                <Card className={`p-10 text-center ${aprobada ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-red-500'}`}>
                    {aprobada
                        ? <Trophy className="mx-auto mb-5 h-16 w-16 text-emerald-400" />
                        : <XCircle className="mx-auto mb-5 h-16 w-16 text-red-500" />}

                    <h2 className="mb-2 text-3xl font-bold">
                        {aprobada ? t('juegos.sp_superada') : t('juegos.sp_no_superada')}
                    </h2>
                    <p className="mb-6 text-text-secondary">
                        {t('juegos.sp_aciertos', { aciertos: resultado.aciertos, pasos: resultado.pasos })}
                    </p>

                    <div className={`mx-auto mb-6 w-fit rounded-full px-6 py-3 text-2xl font-black ${
                        aprobada ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'
                    }`}>
                        {resultado.score}%
                    </div>

                    <p className="mb-8 text-sm text-text-secondary">
                        {aprobada
                            ? t('juegos.sp_registrado_aprobada')
                            : t('juegos.sp_registrado_reprobada')}
                    </p>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <Button className="flex-1" onClick={() => window.location.href = '/performance'}>
                            {t('juegos.sp_ver_desempeno')}
                        </Button>
                        <Button variant="outline" className="flex-1 border-gray-700" onClick={reiniciar}>
                            <RotateCcw className="mr-2 h-4 w-4" /> {t('juegos.sp_intentar_de_nuevo')}
                        </Button>
                    </div>
                </Card>
            </Pantalla>
        );
    }

    // Paso en curso -----------------------------------------------------
    return (
        <Pantalla>
            <div className="mb-6">
                <div className="mb-2 flex items-center justify-between text-sm text-text-secondary">
                    <span>{t('juegos.sp_paso', { n: pasoActual + 1, total: pasos.length })}</span>
                    <span>{simulacion.difficulty}</span>
                </div>
                {/* Barra de avance por pasos, no por puntaje. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                    <div
                        className="h-full rounded-full bg-brand-blue transition-all duration-500"
                        style={{ width: `${((pasoActual + (respuesta ? 1 : 0)) / pasos.length) * 100}%` }}
                    />
                </div>
            </div>

            <Card className="mb-6 p-8">
                <div className="mb-4 flex items-center gap-2 text-brand-light">
                    <Target className="h-5 w-5" />
                    <span className="text-sm font-semibold uppercase tracking-wider">{t('juegos.sp_escenario')}</span>
                </div>
                <p className="text-lg leading-relaxed">{paso.scenario_text}</p>
            </Card>

            <div className="space-y-3">
                {paso.options.map((o) => {
                    const elegida = respuesta && elegidas[pasoActual] === o.id;

                    return (
                        <button
                            key={o.id}
                            onClick={() => elegir(o)}
                            disabled={!!respuesta || enviando}
                            className={`w-full rounded-xl border p-5 text-left transition-colors ${
                                elegida
                                    ? (respuesta.is_correct
                                        ? 'border-emerald-500 bg-emerald-500/10'
                                        : 'border-red-500 bg-red-500/10')
                                    : respuesta
                                        ? 'border-gray-800 bg-bg-card/40 opacity-50'
                                        : 'border-gray-700 bg-bg-card hover:border-brand-blue/60'
                            } ${respuesta ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                            <div className="flex items-start gap-3">
                                {elegida && (respuesta.is_correct
                                    ? <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                                    : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />)}
                                <span>{o.option_text}</span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Criterio de aceptacion de la HU de simulaciones: retroalimentacion
                inmediata despues de cada decision, no solo al final. */}
            {respuesta && (
                <Card className={`mt-6 p-6 ${respuesta.is_correct ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-red-500'}`}>
                    <p className={`mb-2 font-bold ${respuesta.is_correct ? 'text-emerald-400' : 'text-red-400'}`}>
                        {respuesta.is_correct ? t('juegos.sp_decision_correcta') : t('juegos.sp_decision_incorrecta')}
                        {respuesta.puntos_estimados > 0 && (
                            <span className="ml-2 text-sm font-normal text-brand-light">
                                {t('juegos.sp_mas_pts', { n: respuesta.puntos_estimados })}
                            </span>
                        )}
                    </p>
                    {respuesta.feedback && (
                        <p className="text-sm text-text-secondary">{respuesta.feedback}</p>
                    )}
                    {respuesta.ya_contabilizada && (
                        <p className="mt-2 text-xs text-text-secondary">
                            {t('juegos.sp_ya_contabilizada')}
                        </p>
                    )}

                    <Button className="mt-5 w-full" onClick={continuar} disabled={enviando}>
                        {esUltimo ? t('juegos.sp_terminar') : t('juegos.sp_siguiente_paso')}
                    </Button>
                </Card>
            )}
        </Pantalla>
    );
}

/** Marco comun, para no repetir la cabecera en cada estado de la pantalla. */
function Pantalla({ children }) {
    const { t } = useIdioma();

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-3xl">
                <a href="/challenges" className="mb-6 inline-flex items-center gap-2 text-text-secondary hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> {t('juegos.sp_volver_desafios')}
                </a>
                <div className="mb-8 flex items-center gap-3">
                    <ShieldCheck className="h-7 w-7 text-brand-blue" />
                    <h1 className="text-2xl font-bold">{t('juegos.sp_titulo')}</h1>
                </div>
                {children}
            </div>
        </div>
    );
}
