import React, { useState } from 'react';
import { ShieldCheck, Mail, ArrowLeft, Send } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import axios from 'axios';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle, loading, success
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;

    setStatus('loading');
    setErrorMsg('');
    
    try {
      await axios.post('http://localhost:3000/api/auth/forgot-password', { email });
      setStatus('success');
    } catch (error) {
      setStatus('idle');
      setErrorMsg(error.response?.data?.msg || 'Error de conexión con el servidor base.');
    }
  };

  return (
    <div className="min-h-screen bg-bg-deep flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-blue/20 blur-[100px] rounded-full pointer-events-none"></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md z-10">
        <div className="flex justify-center flex-col items-center">
          <ShieldCheck className="w-16 h-16 text-brand-blue mb-4 animate-pulse-slow" />
          <h2 className="text-3xl font-bold text-text-primary tracking-tight">Recuperar Acceso</h2>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md z-10">
        <Card className="py-8 px-4 shadow-[0_0_50px_rgba(37,99,235,0.15)] sm:rounded-xl sm:px-10 border border-gray-800 bg-bg-deep/80 backdrop-blur-xl">
          
          {status === 'success' ? (
            <div className="text-center animate-in zoom-in">
               <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                 <Mail className="w-8 h-8 text-emerald-400" />
               </div>
               <h3 className="text-xl font-bold text-emerald-400 mb-2">Instrucciones Enviadas</h3>
               <p className="text-text-secondary text-sm mb-6">Hemos enviado un enlace seguro al correo <strong>{email}</strong>. Por favor, revisa tu bandeja de entrada.</p>
               <Button variant="outline" className="w-full" onClick={() => window.location.href='/login'}>
                 Regresar al Inicio de Sesión
               </Button>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <p className="text-text-secondary text-sm text-center">Ingresa el correo corporativo asociado a tu cuenta y te enviaremos instrucciones para generar una nueva contraseña maestra.</p>
              
              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg text-sm text-center animate-pulse">
                  {errorMsg}
                </div>
              )}

              <Input
                icon={Mail}
                label="Correo Electrónico"
                type="email"
                placeholder="juan.perez@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <div>
                <Button type="submit" className="w-full group py-3" disabled={status === 'loading'}>
                  {status === 'loading' ? (
                    'Enviando enlace...'
                  ) : (
                    <>
                      Enviar Enlace de Recuperación <Send className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-4 text-center">
                <a href="/login" className="flex items-center justify-center text-sm font-medium text-brand-light hover:text-blue-400 transition-colors">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Volver al Login
                </a>
              </div>
            </form>
          )}

        </Card>
      </div>
    </div>
  );
}
