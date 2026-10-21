import React, { useState } from 'react';
import { Target, MessageCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { registrarDesafio } from '../../lib/api';
import { usePuntos } from '../../context/PuntosContext';
import { useIdioma } from '../../context/useIdioma';

export default function SocialEngineeringGame() {
  const { t } = useIdioma();
  const { notificarPuntos } = usePuntos();
  const [gameState, setGameState] = useState('playing'); // playing, won, lost

  const submitDecision = async (isCorrect) => {
    setGameState(isCorrect ? 'won' : 'lost');

    // FALLO CORREGIDO: antes se registraba el desafio sin decir como habia
    // salido, y el backend lo daba por aprobado siempre. Transferirle el
    // dinero al falso CEO otorgaba los mismos puntos que detectar la estafa.
    const data = await registrarDesafio('social', isCorrect);
    if (data?.puntos_estimados > 0) {
      notificarPuntos(data.puntos_estimados, 'Ingeniería Social');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4 flex items-center justify-center">
      <Card className="w-full max-w-sm bg-gray-50 overflow-hidden relative">
        
        {/* Cabecera iPhone / WhatsApp fake */}
        <div className="bg-[#075E54] text-white p-4 flex items-center gap-3 shadow-md z-10 relative">
          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center overflow-hidden">
             <img src="https://i.pravatar.cc/150?u=a042581f4e29026024d" alt="CEO Avatar" />
          </div>
          <div>
            <h3 className="font-bold leading-tight">Juan C. (CEO Empresa)</h3>
            <span className="text-xs text-green-200">en línea</span>
          </div>
        </div>

        <div className="h-96 bg-[#e5ddd5] p-4 flex flex-col gap-3 overflow-y-auto relative">
           
           <div className="bg-white p-3 rounded-lg rounded-tl-none self-start max-w-[85%] text-gray-800 shadow-sm relative text-sm">
             Hola, ¿estás disponible? Necesito un favor urgente.
             <span className="text-3xs text-gray-400 block text-right mt-1">10:41 AM</span>
           </div>

           <div className="bg-white p-3 rounded-lg rounded-tl-none self-start max-w-[85%] text-gray-800 shadow-sm relative text-sm">
             Estoy en una reunión con unos inversionistas chinos y mi tarjeta corporativa fue bloqueada por estar fuera del país.
             <span className="text-3xs text-gray-400 block text-right mt-1">10:42 AM</span>
           </div>

           <div className="bg-white p-3 rounded-lg rounded-tl-none self-start max-w-[85%] text-gray-800 shadow-sm relative text-sm">
             Necesito que me hagas una transferencia rápida de $1,500 USD a esta cuenta de Binance para pagar la cena del cierre del trato. Te lo devuelvo firmado por nómina mañana mismo a primera hora. ¡Urgente por favor! Es confidencial, no le digas a Finanzas aún.
             <span className="text-3xs text-gray-400 block text-right mt-1">10:42 AM</span>
           </div>

           {gameState === 'playing' && (
             <div className="mt-auto flex flex-col gap-2 relative z-10 pt-4">
                <Button className="bg-green-600 hover:bg-green-700" onClick={() => submitDecision(false)}>
                  {t('juegos.se_transferir')}
                </Button>
                <Button variant="outline" className="border-red-600 border-2 text-red-600 hover:bg-red-50 font-bold bg-white" onClick={() => submitDecision(true)}>
                  {t('juegos.se_bloquear')}
                </Button>
             </div>
           )}

        </div>

        {gameState === 'won' && (
           <div className="absolute inset-0 bg-emerald-900/90 p-6 flex flex-col items-center justify-center text-center z-20">
             <ShieldCheck className="w-16 h-16 text-emerald-400 mb-4" />
             <h3 className="text-2xl font-bold text-white mb-2">{t('juegos.se_ganaste_titulo')}</h3>
             <p className="text-sm text-emerald-100 mb-6 font-medium">{t('juegos.se_ganaste_detalle')}</p>
             <div className="bg-emerald-950 px-6 py-2 rounded font-bold text-emerald-400 mb-6">{t('juegos.se_puntos')}</div>
             <Button onClick={() => window.location.href='/challenges'} className="w-full">{t('juegos.volver_a_misiones')}</Button>
           </div>
        )}

        {gameState === 'lost' && (
           <div className="absolute inset-0 bg-red-900/95 p-6 flex flex-col items-center justify-center text-center z-20">
             <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
             <h3 className="text-2xl font-bold text-white mb-2">{t('juegos.se_perdiste_titulo')}</h3>
             <p className="text-sm text-red-100 mb-4 font-medium">{t('juegos.se_perdiste_detalle')}</p>
             <p className="mb-6 text-xs text-red-200">{t('juegos.cero_puntos_registrado_en')} <strong>{t('desempeno.titulo')}</strong>.</p>
             <Button variant="outline" onClick={() => window.location.href='/performance'} className="w-full text-red-100 border-red-500">{t('juegos.ver_que_repasar')}</Button>
           </div>
        )}
      </Card>
    </div>
  );
}
