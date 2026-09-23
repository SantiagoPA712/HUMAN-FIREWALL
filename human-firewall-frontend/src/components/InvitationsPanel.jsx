import React, { useCallback, useEffect, useState } from 'react';
import { MailPlus, RefreshCw, Send, Ban, Clock, CheckCircle2, XCircle, Hourglass, BellRing } from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { api } from '../lib/api';

const ROLES = { employee: 'Empleado', instructor: 'Instructor', rh: 'Recursos Humanos' };

const ESTILO_ESTADO = {
    pendiente: { clase: 'bg-brand-blue/15 text-brand-light', icono: Hourglass },
    aceptada:  { clase: 'bg-emerald-500/15 text-emerald-400', icono: CheckCircle2 },
    expirada:  { clase: 'bg-amber-500/15 text-amber-400', icono: Clock },
    cancelada: { clase: 'bg-gray-700/40 text-gray-400', icono: XCircle }
};

const ACCIONES = {
    created: 'Creada', resent: 'Reenviada', cancelled: 'Cancelada',
    accepted: 'Aceptada', expired: 'Venció', resend_requested: 'Pidió reenvío'
};

const fecha = (iso) => iso
    ? new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

/**
 * Invitaciones de usuarios, dentro del panel de administracion.
 *
 * Criterio de aceptacion 1: invitar con correo y rol, y ver el estado de cada
 * invitacion. Criterio 4: reenviar o cancelar las que no fueron aceptadas.
 *
 * La pantalla no decide que se puede hacer con cada una: ofrece reenviar y
 * cancelar solo en las pendientes o vencidas, pero el que manda es el backend,
 * que responde 409 con el estado actual si algo cambio mientras tanto.
 */
export default function InvitationsPanel() {
    const [datos, setDatos] = useState(null);
    const [filtro, setFiltro] = useState('');
    const [email, setEmail] = useState('');
    const [rol, setRol] = useState('employee');
    const [idioma, setIdioma] = useState('');
    const [aviso, setAviso] = useState(null);
    const [trabajando, setTrabajando] = useState(false);
    const [abierta, setAbierta] = useState(null);

    const cargar = useCallback(async () => {
        try {
            const { data } = await api.get('/api/invitations', { params: filtro ? { estado: filtro } : {} });
            setDatos(data);
        } catch (e) {
            setAviso({ tipo: 'error', texto: e.response?.data?.msg || 'No se pudieron cargar las invitaciones' });
        }
    }, [filtro]);

    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    useEffect(() => { cargar(); }, [cargar]);

    const mensajeDeError = (e, porDefecto) => {
        const cuerpo = e.response?.data;
        if (cuerpo?.errores) return cuerpo.errores.map(x => x.detalle).join(' ');
        return cuerpo?.msg || porDefecto;
    };

    const invitar = async (e) => {
        e.preventDefault();
        setTrabajando(true);
        setAviso(null);
        try {
            const { data } = await api.post('/api/invitations', { email, role: rol, language: idioma || null });
            setAviso({ tipo: 'ok', texto: `Invitación enviada a ${data.email}.` });
            setEmail('');
            cargar();
        } catch (err) {
            setAviso({ tipo: 'error', texto: mensajeDeError(err, 'No se pudo crear la invitación') });
        } finally {
            setTrabajando(false);
        }
    };

    const accion = async (inv, tipo) => {
        if (tipo === 'cancelar' && !window.confirm(`¿Cancelar la invitación de ${inv.email}? El enlace dejará de funcionar.`)) {
            return;
        }
        setAviso(null);
        try {
            await api.post(`/api/invitations/${inv.id}/${tipo}`);
            setAviso({
                tipo: 'ok',
                texto: tipo === 'reenviar'
                    ? `Se envió un enlace nuevo a ${inv.email}. El anterior ya no funciona.`
                    : `Invitación de ${inv.email} cancelada.`
            });
        } catch (err) {
            setAviso({ tipo: 'error', texto: mensajeDeError(err, 'No se pudo completar la acción') });
        } finally {
            cargar();
        }
    };

    return (
        <div className="space-y-6">
            <Card className="p-6 hover:scale-100">
                <h3 className="mb-1 flex items-center gap-2 text-lg font-bold">
                    <MailPlus className="h-5 w-5 text-brand-blue" /> Invitar a una persona
                </h3>
                <p className="mb-4 text-sm text-text-secondary">
                    Le llega un correo con un enlace de un solo uso para definir su contraseña. No hace falta compartir credenciales.
                </p>

                <form onSubmit={invitar} className="flex flex-wrap items-end gap-3">
                    <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm">
                        <span className="text-text-secondary">Correo</span>
                        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                               placeholder="nombre@empresa.com"
                               className="rounded-lg border border-gray-700 bg-bg-deep/50 px-3 py-2 text-white" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-text-secondary">Rol</span>
                        <select value={rol} onChange={e => setRol(e.target.value)}
                                className="rounded-lg border border-gray-700 bg-bg-deep/50 px-3 py-2 text-white">
                            {Object.entries(ROLES).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-text-secondary">Idioma del correo</span>
                        <select value={idioma} onChange={e => setIdioma(e.target.value)}
                                className="rounded-lg border border-gray-700 bg-bg-deep/50 px-3 py-2 text-white">
                            <option value="">Predeterminado</option>
                            <option value="es">Español</option>
                            <option value="en">English</option>
                        </select>
                    </label>
                    <Button type="submit" disabled={trabajando} className="py-2">
                        <Send className="h-4 w-4" /> {trabajando ? 'Enviando…' : 'Enviar invitación'}
                    </Button>
                </form>

                {aviso && (
                    <p className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                        aviso.tipo === 'ok'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-red-500/40 bg-red-500/10 text-red-300'
                    }`}>
                        {aviso.texto}
                    </p>
                )}
            </Card>

            <Card className="p-6 hover:scale-100">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-bold">Invitaciones</h3>
                    <div className="flex items-center gap-2">
                        {['', 'pendiente', 'aceptada', 'expirada', 'cancelada'].map(f => (
                            <button key={f || 'todas'} onClick={() => setFiltro(f)}
                                    className={`rounded-full border px-3 py-1 text-xs ${
                                        filtro === f ? 'border-brand-blue bg-brand-blue/15 text-brand-light' : 'border-gray-700 text-text-secondary'
                                    }`}>
                                {f ? `${f[0].toUpperCase()}${f.slice(1)}s` : 'Todas'}
                                {f && datos ? ` (${datos.resumen[f]})` : ''}
                            </button>
                        ))}
                        <button onClick={cargar} title="Actualizar" className="p-1 text-text-secondary hover:text-white">
                            <RefreshCw className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {!datos ? (
                    <p className="py-6 text-center text-sm text-text-secondary">Cargando…</p>
                ) : datos.invitaciones.length === 0 ? (
                    <p className="py-6 text-center text-sm text-text-secondary">No hay invitaciones {filtro ? `en estado ${filtro}` : 'todavía'}.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-sm">
                            <thead>
                                <tr className="border-b border-gray-700 text-gray-400">
                                    <th className="p-3 font-medium">Correo</th>
                                    <th className="p-3 font-medium">Rol</th>
                                    <th className="p-3 font-medium">Estado</th>
                                    <th className="p-3 font-medium">Vence</th>
                                    <th className="p-3 font-medium text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {datos.invitaciones.map(inv => {
                                    const estilo = ESTILO_ESTADO[inv.estado];
                                    const Icono = estilo.icono;
                                    const accionable = inv.estado === 'pendiente' || inv.estado === 'expirada';
                                    return (
                                        <React.Fragment key={inv.id}>
                                            <tr className="border-b border-gray-800 hover:bg-gray-800/40">
                                                <td className="p-3">
                                                    <button className="text-left hover:underline" onClick={() => setAbierta(abierta === inv.id ? null : inv.id)}>
                                                        {inv.email}
                                                    </button>
                                                    <p className="text-xs text-gray-500">
                                                        por {inv.invited_by_email || 'admin eliminado'} · {inv.send_count} envío{inv.send_count > 1 ? 's' : ''}
                                                    </p>
                                                </td>
                                                <td className="p-3">{ROLES[inv.role] || inv.role}</td>
                                                <td className="p-3">
                                                    <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold ${estilo.clase}`}>
                                                        <Icono className="h-3.5 w-3.5" /> {inv.estado}
                                                    </span>
                                                    {inv.resend_requested_at && inv.estado === 'expirada' && (
                                                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-300" title="La persona pidió un enlace nuevo">
                                                            <BellRing className="h-3.5 w-3.5" /> pidió reenvío
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-xs text-text-secondary">
                                                    {inv.estado === 'aceptada' ? `aceptada ${fecha(inv.accepted_at)}` : fecha(inv.expires_at)}
                                                </td>
                                                <td className="p-3 text-right">
                                                    {accionable && (
                                                        <div className="inline-flex gap-2">
                                                            <button onClick={() => accion(inv, 'reenviar')}
                                                                    className="inline-flex items-center gap-1 rounded-lg border border-gray-600 px-2 py-1 text-xs hover:bg-gray-800">
                                                                <Send className="h-3.5 w-3.5" /> Reenviar
                                                            </button>
                                                            <button onClick={() => accion(inv, 'cancelar')}
                                                                    className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10">
                                                                <Ban className="h-3.5 w-3.5" /> Cancelar
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                            {abierta === inv.id && (
                                                <tr className="border-b border-gray-800 bg-gray-900/40">
                                                    <td colSpan={5} className="px-6 py-3">
                                                        <p className="mb-2 text-xs font-semibold text-text-secondary">Historial</p>
                                                        <ol className="space-y-1 text-xs">
                                                            {inv.historial.map((h, i) => (
                                                                <li key={i} className="flex gap-3">
                                                                    <span className="w-28 text-text-secondary">{fecha(h.en)}</span>
                                                                    <span>{ACCIONES[h.accion] || h.accion}</span>
                                                                </li>
                                                            ))}
                                                        </ol>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
