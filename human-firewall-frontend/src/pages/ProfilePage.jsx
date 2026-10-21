import React, { useEffect, useState } from 'react';
import {
    ArrowLeft, UserCircle2, Pencil, Save, X, Lock, Mail, Shield, Users, CalendarDays,
    CheckCircle2, AlertTriangle, Info, Phone, Languages
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, getUsuarioActual } from '../lib/api';
import { formularioDesde, validarFormulario, cambiosRespectoDe } from '../lib/perfil';

const ROLES = {
    admin: 'Administrador del Sistema',
    security: 'Oficial de Seguridad (CISO)',
    rh: 'Recursos Humanos',
    manager: 'Gerencia / Manager',
    instructor: 'Instructor',
    employee: 'Empleado'
};

const IDIOMAS = { '': 'El de la plataforma', es: 'Español', en: 'English' };

const formatearFecha = (iso) => iso
    ? new Date(iso).toLocaleString('es', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

/**
 * Mi perfil (HU de perfil editable).
 *
 * Se consulta siempre desde el backend (GET /api/users/me) y no desde el
 * token: el token solo trae id y rol, y lo que se guardo tiene que verse al
 * volver (criterio de aceptacion 7).
 */
export default function ProfilePage() {
    const [perfil, setPerfil] = useState(null);
    const [formulario, setFormulario] = useState(formularioDesde(null));
    const [editando, setEditando] = useState(false);
    const [errores, setErrores] = useState({});
    const [aviso, setAviso] = useState(null); // { tipo: 'exito' | 'info' | 'error', texto }
    const [guardando, setGuardando] = useState(false);
    const [errorDeCarga, setErrorDeCarga] = useState(null);
    const usuarioId = getUsuarioActual()?.id;

    useEffect(() => {
        if (!usuarioId) { window.location.href = '/login'; return; }

        api.get('/api/users/me')
            .then(({ data }) => {
                setPerfil(data);
                setFormulario(formularioDesde(data));
            })
            .catch((e) => setErrorDeCarga(e.response?.data?.msg || 'No se pudo cargar tu perfil'));
    }, [usuarioId]);

    const { errores: erroresActuales, valores } = validarFormulario(formulario);
    const hayCambios = perfil && Object.keys(cambiosRespectoDe(perfil, valores)).length > 0;

    const cambiar = (campo) => (e) => {
        setFormulario((f) => ({ ...f, [campo]: e.target.value }));
        // El error de un campo se va en cuanto se corrige, sin esperar a guardar.
        setErrores((prev) => {
            if (!prev[campo]) return prev;
            const { [campo]: _, ...resto } = prev;
            return resto;
        });
    };

    // El formulario siempre arranca desde lo guardado, no desde lo que haya
    // quedado de una edicion anterior.
    const iniciarEdicion = () => {
        setFormulario(formularioDesde(perfil));
        setAviso(null);
        setErrores({});
        setEditando(true);
    };

    // Criterio de aceptacion 6: cancelar descarta lo que no se guardo. Antes
    // solo cerraba el formulario: lo escrito quedaba en el estado, volvia a
    // aparecer al pulsar "Editar perfil" y se podia guardar sin querer.
    const cancelar = () => {
        setFormulario(formularioDesde(perfil));
        setErrores({});
        setAviso(null);
        setEditando(false);
    };

    const guardar = async (e) => {
        e.preventDefault();
        setAviso(null);

        // Criterio de aceptacion 4: se avisa antes de enviar.
        if (Object.keys(erroresActuales).length > 0) {
            setErrores(erroresActuales);
            return;
        }

        // Criterio de aceptacion 5: sin cambios no hay solicitud.
        const cambios = cambiosRespectoDe(perfil, valores);
        if (Object.keys(cambios).length === 0) {
            setAviso({ tipo: 'info', texto: 'No hay cambios para guardar.' });
            return;
        }

        setGuardando(true);
        try {
            const { data } = await api.patch('/api/users/me', cambios);
            setPerfil(data);
            setFormulario(formularioDesde(data));
            setEditando(false);
            setAviso({ tipo: data.sin_cambios ? 'info' : 'exito', texto: data.msg });
        } catch (err) {
            // Criterio de aceptacion 9: si no se guardo, no hay confirmacion.
            // El formulario queda como estaba para que no se pierda lo escrito.
            const cuerpo = err.response?.data;
            if (err.response?.status === 400 && Array.isArray(cuerpo?.errores)) {
                setErrores(Object.fromEntries(cuerpo.errores.map((x) => [x.campo, x.detalle])));
                setAviso({ tipo: 'error', texto: 'Revisa los campos marcados.' });
            } else {
                setAviso({
                    tipo: 'error',
                    texto: cuerpo?.msg && err.response?.status !== 500
                        ? cuerpo.msg
                        : 'No se pudo guardar tu perfil. Los cambios no se aplicaron; intenta de nuevo en unos minutos.'
                });
            }
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-3xl">
                <div className="mb-6 flex items-center justify-between">
                    <a href="/dashboard" className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary">
                        <ArrowLeft className="h-4 w-4" /> Volver al panel
                    </a>
                    <ThemeToggle />
                </div>

                <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-3 text-3xl font-bold">
                            <UserCircle2 className="h-8 w-8 text-brand-blue" />
                            Mi perfil
                        </h1>
                        <p className="mt-1 text-text-secondary">
                            Tu información personal registrada en Human Firewall.
                        </p>
                    </div>
                    {perfil && !editando && (
                        <button
                            type="button"
                            onClick={iniciarEdicion}
                            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 font-semibold text-white transition-colors hover:bg-brand-light cursor-pointer"
                        >
                            <Pencil className="h-4 w-4" /> Editar perfil
                        </button>
                    )}
                </header>

                {aviso && <Aviso {...aviso} onCerrar={() => setAviso(null)} />}

                {errorDeCarga && (
                    <Card className="border-l-4 border-l-red-500 p-6">
                        <p className="text-red-400">{errorDeCarga}</p>
                    </Card>
                )}

                {!errorDeCarga && !perfil && <p className="text-text-secondary">Cargando…</p>}

                {perfil && (
                    <>
                        <Card className="mb-6 p-6">
                            <h2 className="mb-1 text-lg font-bold">Datos personales</h2>
                            <p className="mb-5 text-sm text-text-secondary">
                                {editando
                                    ? 'Los campos con * son obligatorios.'
                                    : 'Puedes actualizar tu nombre, tu teléfono y el idioma de tus correos.'}
                            </p>

                            {editando ? (
                                <form onSubmit={guardar} noValidate className="flex flex-col gap-5">
                                    <Campo
                                        id="full_name"
                                        etiqueta="Nombre completo *"
                                        icono={UserCircle2}
                                        error={errores.full_name}
                                    >
                                        <input
                                            id="full_name"
                                            type="text"
                                            maxLength={150}
                                            autoComplete="name"
                                            value={formulario.full_name}
                                            onChange={cambiar('full_name')}
                                            aria-invalid={!!errores.full_name}
                                            aria-describedby={errores.full_name ? 'full_name-error' : undefined}
                                            className={claseDeInput(errores.full_name)}
                                            placeholder="Ana María Pérez"
                                        />
                                    </Campo>

                                    <Campo id="phone" etiqueta="Teléfono" icono={Phone} error={errores.phone} ayuda="Opcional. Con indicativo del país si es de otro país.">
                                        <input
                                            id="phone"
                                            type="tel"
                                            maxLength={30}
                                            autoComplete="tel"
                                            value={formulario.phone}
                                            onChange={cambiar('phone')}
                                            aria-invalid={!!errores.phone}
                                            aria-describedby={errores.phone ? 'phone-error' : undefined}
                                            className={claseDeInput(errores.phone)}
                                            placeholder="+57 300 123 4567"
                                        />
                                    </Campo>

                                    <Campo id="language" etiqueta="Idioma de los correos" icono={Languages} error={errores.language}>
                                        <select
                                            id="language"
                                            value={formulario.language}
                                            onChange={cambiar('language')}
                                            className={claseDeInput(errores.language)}
                                        >
                                            {Object.entries(IDIOMAS).map(([valor, texto]) => (
                                                <option key={valor} value={valor}>{texto}</option>
                                            ))}
                                        </select>
                                    </Campo>

                                    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-color pt-5">
                                        <button
                                            type="button"
                                            onClick={cancelar}
                                            disabled={guardando}
                                            className="inline-flex items-center gap-2 rounded-lg border border-border-color px-4 py-2 font-medium text-text-secondary transition-colors hover:bg-nav-hover hover:text-text-primary disabled:opacity-50 cursor-pointer"
                                        >
                                            <X className="h-4 w-4" /> Cancelar
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={guardando || !hayCambios}
                                            title={!hayCambios ? 'No hay cambios para guardar' : undefined}
                                            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 font-semibold text-white transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                        >
                                            <Save className="h-4 w-4" />
                                            {guardando ? 'Guardando…' : 'Guardar cambios'}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                                    <Dato icono={UserCircle2} etiqueta="Nombre completo" valor={perfil.full_name} vacio="Sin registrar" />
                                    <Dato icono={Phone} etiqueta="Teléfono" valor={perfil.phone} vacio="Sin registrar" />
                                    <Dato icono={Languages} etiqueta="Idioma de los correos" valor={IDIOMAS[perfil.language || '']} />
                                </dl>
                            )}
                        </Card>

                        {/* Criterio de aceptacion 8: lo protegido se ve pero no se edita. */}
                        <Card className="p-6">
                            <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
                                <Lock className="h-4 w-4 text-text-secondary" /> Datos de la cuenta
                            </h2>
                            <p className="mb-5 text-sm text-text-secondary">
                                Estos datos los administra la organización. Si alguno no es correcto, pide el cambio a un administrador.
                            </p>
                            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                                <Dato icono={Mail} etiqueta="Correo (usuario de acceso)" valor={perfil.email} />
                                <Dato icono={Shield} etiqueta="Rol" valor={ROLES[perfil.role] || perfil.role} />
                                <Dato icono={Users} etiqueta="Equipo" valor={perfil.team_name} vacio="Sin equipo asignado" />
                                <Dato icono={CalendarDays} etiqueta="Miembro desde" valor={formatearFecha(perfil.created_at)} />
                            </dl>
                        </Card>
                    </>
                )}
            </div>
        </div>
    );
}

const claseDeInput = (error) =>
    `w-full rounded-lg border bg-bg-card px-4 py-2.5 text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:ring-1 transition-all ${
        error
            ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
            : 'border-border-color focus:border-brand-blue focus:ring-brand-blue'
    }`;

function Campo({ id, etiqueta, icono, error, ayuda, children }) {
    const Icono = icono;
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
                <Icono className="h-4 w-4 text-brand-blue" /> {etiqueta}
            </label>
            {children}
            {error ? (
                <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-sm text-red-500">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
            ) : ayuda && <p className="text-xs text-text-secondary">{ayuda}</p>}
        </div>
    );
}

function Dato({ icono, etiqueta, valor, vacio = '—' }) {
    const Icono = icono;
    return (
        <div className="min-w-0">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                <Icono className="h-3.5 w-3.5" /> {etiqueta}
            </dt>
            <dd className={`mt-1 break-words ${valor ? 'font-medium text-text-primary' : 'italic text-text-secondary'}`}>
                {valor || vacio}
            </dd>
        </div>
    );
}

const ESTILOS_AVISO = {
    exito: { clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500', icono: CheckCircle2 },
    info: { clase: 'border-brand-blue/40 bg-brand-blue/10 text-brand-blue', icono: Info },
    error: { clase: 'border-red-500/40 bg-red-500/10 text-red-500', icono: AlertTriangle }
};

function Aviso({ tipo, texto, onCerrar }) {
    const { clase, icono: Icono } = ESTILOS_AVISO[tipo];
    return (
        <div role={tipo === 'error' ? 'alert' : 'status'} className={`mb-6 flex items-start gap-3 rounded-xl border p-4 ${clase}`}>
            <Icono className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="flex-1 font-medium">{texto}</p>
            <button type="button" onClick={onCerrar} aria-label="Cerrar aviso" className="opacity-70 hover:opacity-100 cursor-pointer">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
