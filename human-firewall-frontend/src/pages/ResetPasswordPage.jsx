import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, CheckCircle } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import api from '../lib/api';
import { useIdioma } from '../context/useIdioma';

export default function ResetPasswordPage() {
  const { t } = useIdioma();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [token, setToken] = useState(null);
  
  const [status, setStatus] = useState('idle'); // idle, loading, success
  const [errorMsg, setErrorMsg] = useState('');

  // Este efecto queda igual que estaba. Lo unico que cambia es que el aviso
  // sale del diccionario y que `t` entra en las dependencias.
  useEffect(() => {
    // Al cargar el componente, atrapar el ?token=xyz desde la URL del navegador
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
    } else {
      setErrorMsg(t('acceso.sin_token'));
    }
  }, [t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (password !== confirmPassword) {
      return setErrorMsg(t('acceso.contrasenas_no_coinciden'));
    }

    if (!token) {
      return setErrorMsg(t('acceso.token_invalido'));
    }

    setStatus('loading');
    
    try {
      await api.post('/api/auth/reset-password', { 
         token, 
         newPassword: password 
      });
      setStatus('success');
    } catch (error) {
      setStatus('idle');
      // La Regex o caída de token del backend llegará aquí como CA6
      setErrorMsg(error.response?.data?.msg || t('acceso.error_conexion_reset'));
    }
  };

  return (
    <div className="min-h-screen bg-bg-deep flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none"></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md z-10">
        <div className="flex justify-center flex-col items-center">
          <ShieldCheck className="w-16 h-16 text-emerald-400 mb-4" />
          <h2 className="text-3xl font-bold text-text-primary tracking-tight">{t('acceso.nueva_contrasena_titulo')}</h2>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md z-10">
        <Card className="py-8 px-4 shadow-[0_0_50px_rgba(16,185,129,0.1)] sm:rounded-xl sm:px-10 border border-gray-800 bg-bg-deep/80 backdrop-blur-xl">
          
          {status === 'success' ? (
            <div className="text-center animate-in zoom-in">
               <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                 <CheckCircle className="w-8 h-8 text-emerald-400" />
               </div>
               <h3 className="text-xl font-bold text-emerald-400 mb-2">{t('acceso.contrasena_actualizada')}</h3>
               <p className="text-text-secondary text-sm mb-6">{t('acceso.contrasena_actualizada_ayuda')}</p>
               <Button className="w-full bg-emerald-600 hover:bg-emerald-500" onClick={() => window.location.href='/login'}>
                 {t('acceso.ir_a_login')}
               </Button>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              
              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg text-sm text-center animate-pulse">
                  {errorMsg}
                </div>
              )}

              <Input
                icon={Lock}
                label={t('acceso.nueva_contrasena')}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <Input
                icon={Lock}
                label={t('acceso.confirmar_contrasena')}
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />

              <div>
                <Button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-500" disabled={status === 'loading' || !token}>
                  {status === 'loading' ? t('acceso.procesando') : t('acceso.guardar_actualizar')}
                </Button>
              </div>

            </form>
          )}

        </Card>
      </div>
    </div>
  );
}
