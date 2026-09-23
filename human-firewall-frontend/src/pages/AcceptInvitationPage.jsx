import React, { useEffect, useState } from 'react';
import { MailCheck, Lock, User, Languages, Clock, XCircle, CheckCircle2, Send } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import api from '../lib/api';

const ROLES = { employee: 'Empleado', instructor: 'Instructor', rh: 'Recursos Humanos' };

/**
 * Completar el registro desde una invitacion (HU de invitaciones).
 *
 * El token llega en la URL del correo (?token=...) y se manda al backend en el
 * CUERPO de un POST, nunca en la URL de la API. La pantalla no decide si el
 * enlace sirve: se lo pregunta al backend y dibuja uno de estos estados:
 *
 *   cargando  -> validando el token
 *   form      -> vigente: definir contrasena y completar el perfil (CA 2)
 *   expirada  -> vencio: mensaje y boton para pedir una nueva (CA 3)
 *   rechazada -> inexistente, ya usada o cancelada: sin formulario (CT 2)
 */
export default function AcceptInvitationPage() {
    const token = new URLSearchParams(window.location.search).get('token') || '';

    const [estado, setEstado] = useState('cargando');
    const [invitacion, setInvitacion] = useState(null);
    const [rechazo, setRechazo] = useState(null);

    const [nombre, setNombre] = useState('');
    const [password, setPassword] = useState('');
    const [confirmacion, setConfirmacion] = useState('');
    const [idioma, setIdioma] = useState('');
    const [error, setError] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [reenvio, setReenvio] = useState(null);

    const aplicarRechazo = (e) => {
        const cuerpo = e.response?.data;
        setRechazo(cuerpo || { msg: 'No se pudo verificar la invitacion. Intenta mas tarde.' });
        if (cuerpo?.reenvio_solicitado) setReenvio('ya');
        setEstado(cuerpo?.motivo === 'expirada' ? 'expirada' : 'rechazada');
    };

    useEffect(() => {
        if (!token) {
            /* eslint-disable-next-line react-hooks/set-state-in-effect */
            setRechazo({ msg: 'El enlace de invitacion esta incompleto. Abrilo tal cual llego en el correo.' });
            setEstado('rechazada');
            return;
        }
        api.post('/api/invitations/validar', { token })
            .then(({ data }) => {
                setInvitacion(data);
                setIdioma(data.language || '');
                setEstado('form');
            })
            .catch(aplicarRechazo);
    }, [token]);

    const completar = async (e) => {
        e.preventDefault();
        setError(null);

        if (password !== confirmacion) {
            return setError('Las contraseñas no coinciden.');
        }

        setEnviando(true);
        try {
            const { data } = await api.post('/api/invitations/aceptar', {
                token,
                full_name: nombre,
                password,
                language: idioma || null
            });
            localStorage.setItem('token', data.token);
            window.location.href = '/dashboard';
        } catch (err) {
            const cuerpo = err.response?.data;
            if (err.response?.status === 400 && cuerpo?.errores) {
                setError(cuerpo.errores.map(x => x.detalle).join(' '));
            } else if (cuerpo?.motivo) {
                // El enlace dejo de servir mientras completaba el formulario.
                aplicarRechazo(err);
            } else {
                setError(cuerpo?.msg || 'No se pudo completar el registro.');
            }
        } finally {
            setEnviando(false);
        }
    };

    const pedirReenvio = async () => {
        try {
            const { data } = await api.post('/api/invitations/solicitar-reenvio', { token });
            setReenvio(data.ya_solicitado ? 'ya' : 'enviado');
        } catch (err) {
            setRechazo(err.response?.data || { msg: 'No se pudo enviar el pedido.' });
        }
    };

    return (
        <div className="min-h-screen bg-bg-deep text-text-primary flex flex-col items-center justify-center p-6 bg-gradient-to-b from-bg-deep to-brand-dark/20 relative overflow-hidden">
            <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[100px] rounded-full pointer-events-none"></div>

            <div className="flex flex-col items-center mb-8 z-10 text-center">
                <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 border border-brand-blue/30 shadow-[0_0_15px_rgba(37,99,235,0.2)]">
                    <MailCheck className="w-8 h-8 text-brand-blue" />
                </div>
                <h1 className="text-3xl font-bold">Completá tu registro</h1>
                <p className="text-text-secondary mt-2">Te invitaron a Human Firewall.</p>
            </div>

            <Card className="w-full max-w-md z-10 border border-gray-800 bg-bg-deep/80 backdrop-blur-xl hover:scale-100">
                {estado === 'cargando' && (
                    <p className="py-6 text-center text-text-secondary">Verificando tu invitación…</p>
                )}

                {estado === 'form' && invitacion && (
                    <form onSubmit={completar} className="flex flex-col gap-5">
                        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 text-sm">
                            <p><span className="text-text-secondary">Correo:</span> <strong>{invitacion.email}</strong></p>
                            <p className="mt-1"><span className="text-text-secondary">Rol asignado:</span> <strong>{ROLES[invitacion.role] || invitacion.role}</strong></p>
                            <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">
                                <Clock className="h-3.5 w-3.5" />
                                Vence el {new Date(invitacion.expires_at).toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' })}
                            </p>
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg text-sm text-center">
                                {error}
                            </div>
                        )}

                        <Input icon={User} label="Nombre completo" placeholder="Ana Pérez"
                               className="bg-transparent" value={nombre}
                               onChange={e => setNombre(e.target.value)} required minLength={2} maxLength={150} />

                        <Input icon={Lock} label="Contraseña" type="password" placeholder="••••••••"
                               className="bg-transparent" value={password}
                               onChange={e => setPassword(e.target.value)} required />
                        <p className="-mt-3 text-xs text-text-secondary">Mínimo 8 caracteres, con al menos una mayúscula y un número.</p>

                        <Input icon={Lock} label="Confirmar contraseña" type="password" placeholder="••••••••"
                               className="bg-transparent" value={confirmacion}
                               onChange={e => setConfirmacion(e.target.value)} required />

                        <label className="flex flex-col gap-2 text-sm">
                            <span className="flex items-center gap-2 font-semibold text-text-secondary">
                                <Languages className="h-4 w-4" /> Idioma de los correos
                            </span>
                            <select value={idioma} onChange={e => setIdioma(e.target.value)}
                                    className="rounded-lg border border-gray-700 bg-bg-deep/50 px-4 py-3 text-white">
                                <option value="">Predeterminado de la plataforma</option>
                                <option value="es">Español</option>
                                <option value="en">English</option>
                            </select>
                        </label>

                        <Button type="submit" className="w-full mt-2" disabled={enviando}>
                            {enviando ? 'Activando tu cuenta…' : 'Activar mi cuenta'}
                        </Button>
                    </form>
                )}

                {estado === 'expirada' && (
                    <div className="flex flex-col items-center gap-4 text-center">
                        <Clock className="h-10 w-10 text-amber-400" />
                        <h2 className="text-xl font-bold">Tu invitación venció</h2>
                        <p className="text-sm text-text-secondary">{rechazo?.msg}</p>

                        {reenvio ? (
                            <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                {reenvio === 'ya'
                                    ? 'Ya pediste una nueva invitación. El administrador te la va a reenviar a tu correo.'
                                    : 'Listo: le avisamos al administrador. Te va a llegar una nueva invitación a tu correo.'}
                            </p>
                        ) : (
                            <Button onClick={pedirReenvio} className="w-full">
                                <Send className="h-4 w-4" /> Solicitar una nueva invitación
                            </Button>
                        )}
                    </div>
                )}

                {estado === 'rechazada' && (
                    <div className="flex flex-col items-center gap-4 text-center">
                        <XCircle className="h-10 w-10 text-red-400" />
                        <h2 className="text-xl font-bold">No podemos usar este enlace</h2>
                        <p className="text-sm text-text-secondary">{rechazo?.msg}</p>
                        <Button variant="outline" className="w-full border-gray-700 text-gray-300 hover:bg-gray-800"
                                onClick={() => { window.location.href = '/login'; }}>
                            Ir a iniciar sesión
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    );
}
