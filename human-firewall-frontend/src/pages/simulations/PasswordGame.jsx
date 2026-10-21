import React, { useState } from 'react';
import { Lock, ShieldCheck, CheckCircle, ArrowLeft } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { registrarDesafio } from '../../lib/api';
import { usePuntos } from '../../context/PuntosContext';
import { useIdioma } from '../../context/useIdioma';

export default function PasswordGame() {
  const { t } = useIdioma();
  const { notificarPuntos } = usePuntos();
  const [password, setPassword] = useState('');
  const [gameState, setGameState] = useState('playing'); // playing, won

  // Lógica simple de fortaleza para el MVP interactivo
  const reqLength = password.length >= 12;
  const reqNumber = /[0-9]/.test(password);
  const reqSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const reqUpper = /[A-Z]/.test(password);
  
  const score = [reqLength, reqNumber, reqSpecial, reqUpper].filter(Boolean).length;
  
  const getStrengthLabel = () => {
    if (score === 0) return { label: t('juegos.pw_fuerza_vacia'), color: "bg-gray-800", text: "text-gray-500" };
    if (score <= 2) return { label: t('juegos.pw_fuerza_debil'), color: "bg-red-500", text: "text-red-500" };
    if (score === 3) return { label: t('juegos.pw_fuerza_fuerte'), color: "bg-yellow-500", text: "text-yellow-500" };
    return { label: t('juegos.pw_fuerza_inquebrantable'), color: "bg-emerald-500", text: "text-emerald-500" };
  };

  const strength = getStrengthLabel();

  const submitPassword = async () => {
    // A diferencia de los otros desafios, este no tiene forma de perder: el
    // boton esta deshabilitado hasta cumplir los cuatro requisitos. Por eso
    // siempre se registra como aprobado.
    if (score !== 4) return;

    setGameState('won');

    // El .catch(e=>e) anterior tragaba el error: el usuario veia "ganaste"
    // aunque los puntos nunca se hubieran otorgado. Ahora se avisa.
    const data = await registrarDesafio('password', true);
    if (data?.puntos_estimados > 0) {
      notificarPuntos(data.puntos_estimados, 'Maestro de Contraseñas');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center justify-center">
      <Card className="w-full max-w-lg p-8 shadow-[0_0_50px_rgba(37,99,235,0.1)] border-gray-800 !bg-gray-800">
        
        {gameState === 'playing' ? (
          <>
            <div className="flex items-center gap-3 mb-6 border-b border-gray-800 pb-4">
              <Lock className="w-8 h-8 text-brand-blue" />
              <h2 className="text-2xl font-bold">{t('desafios.password_titulo')}</h2>
            </div>

            <p className="text-text-secondary mb-8 text-sm">{t('juegos.pw_mision')}</p>

            <div className="relative mb-6">
              <input 
                type="text" 
                className="w-full bg-gray-900 border-2 border-gray-700 rounded-lg px-4 py-4 text-xl tracking-widest font-mono focus:border-brand-blue focus:outline-none transition"
                placeholder={t('juegos.pw_placeholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {/* Barras de Fuerza */}
            <div className="flex gap-2 mb-2 h-2">
              <div className={`flex-1 rounded-full transition-all duration-300 ${score >= 1 ? strength.color : 'bg-gray-800'}`}></div>
              <div className={`flex-1 rounded-full transition-all duration-300 ${score >= 2 ? strength.color : 'bg-gray-800'}`}></div>
              <div className={`flex-1 rounded-full transition-all duration-300 ${score >= 3 ? strength.color : 'bg-gray-800'}`}></div>
              <div className={`flex-1 rounded-full transition-all duration-300 ${score === 4 ? strength.color : 'bg-gray-800'}`}></div>
            </div>
            <p className={`text-right text-sm font-bold uppercase tracking-wider mb-8 ${strength.text}`}>{strength.label}</p>

            <div className="space-y-3 mb-8">
              <Requirement check={reqLength} text={t('juegos.pw_req_largo')} />
              <Requirement check={reqUpper} text={t('juegos.pw_req_mayusculas')} />
              <Requirement check={reqNumber} text={t('juegos.pw_req_numeros')} />
              <Requirement check={reqSpecial} text={t('juegos.pw_req_simbolos')} />
            </div>

            <Button 
              className={`w-full py-4 text-lg font-bold ${score === 4 ? 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]' : 'opacity-50 cursor-not-allowed'}`}
              onClick={submitPassword}
              disabled={score !== 4}
            >
              {t('juegos.pw_registrar')}
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center text-center animate-in zoom-in py-8">
             <CheckCircle className="w-20 h-20 text-emerald-500 mb-6" />
             <h3 className="text-3xl font-bold mb-4">{t('juegos.pw_ganaste_titulo')}</h3>
             <p className="text-text-secondary mb-8">{t('juegos.pw_ganaste_detalle')}</p>
             <div className="bg-emerald-900/30 border border-emerald-500/50 text-emerald-400 font-bold px-6 py-3 rounded-full mb-8">
               {t('juegos.pw_puntos')}
             </div>
             <Button onClick={() => window.location.href='/challenges'} variant="outline" className="w-full">{t('juegos.volver_al_dashboard')}</Button>
          </div>
        )}

      </Card>
    </div>
  );
}

function Requirement({ check, text }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-colors ${check ? 'bg-emerald-500 border-emerald-500' : 'border-gray-600 bg-gray-800'}`}>
        {check && <CheckCircle className="w-3 h-3 text-white" />}
      </div>
      <span className={check ? 'text-gray-300' : 'text-gray-600'}>{text}</span>
    </div>
  );
}
