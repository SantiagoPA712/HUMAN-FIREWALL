import React, { useState } from 'react';
import { Wifi, AlertTriangle, ShieldCheck, ArrowRight, Lock } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { registrarDesafio } from '../../lib/api';
import { usePuntos } from '../../context/PuntosContext';

export default function WifiGame() {
  const { notificarPuntos } = usePuntos();
  const [gameState, setGameState] = useState('playing'); // playing, won, lost
  const [loading, setLoading] = useState(false);

  // Redes con su lógica de peligro
  const networks = [
    { id: 1, name: "Starbucks_Free_WiFi", danger: true, points: -50, reason: "Red abierta, frecuentemente interceptada 'Man In The Middle'." },
    { id: 2, name: "G00GLE_STARBUCKS", danger: true, points: -50, reason: "Ataque 'Evil Twin' (Gemelo malicioso). Un hacker creó este nombre." },
    { id: 3, name: "AirPort-Free-Net", danger: true, points: -50, reason: "Red abierta que requiere registro por captive portal sospechoso." },
    { id: 4, name: "iPhone de Laura", danger: false, points: 200, reason: "Red personal protegida por WPA3 controlada por un compañero. Segura." }
  ];

  const connectToNetwork = async (network) => {
    setLoading(true);
    try {
      const acerto = !network.danger;
      setGameState(acerto ? 'won' : 'lost');

      // Antes esto solo se registraba cuando la red elegida era segura
      // (`if (network.points > 0)`), asi que conectarse a una red maliciosa no
      // dejaba rastro y el error nunca llegaba al resumen de desempeno.
      const data = await registrarDesafio('wifi', acerto);
      if (data?.puntos_estimados > 0) {
        notificarPuntos(data.puntos_estimados, 'Wi-Fi Seguro');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex justify-center items-center p-6">
      <Card className="w-full max-w-md bg-[#1c1c1e] text-white overflow-hidden p-0 relative">
        {/* Cabecera Tipo Smartphone */}
        <div className="bg-[#2c2c2e] px-4 py-6 border-b border-gray-700 text-center relative">
          <Wifi className="w-8 h-8 text-blue-500 mx-auto mb-2" />
          <h2 className="text-xl font-bold tracking-tight">Seleccionar Red</h2>
          <p className="text-xs text-gray-400 mt-1">Estás en un aeropuerto a punto de enviar el cierre mensual con datos confidenciales. Elige cautelosamente.</p>
        </div>

        <div className="divide-y divide-gray-800">
          {networks.map(net => (
            <div key={net.id} className="p-4 hover:bg-gray-800 transition flex items-center justify-between cursor-pointer group" onClick={() => gameState === 'playing' && connectToNetwork(net)}>
              <div className="flex items-center gap-4">
                <Wifi className={`w-5 h-5 ${net.danger ? 'text-gray-400' : 'text-gray-400 group-hover:text-blue-400'}`} />
                <span className="font-medium group-hover:text-blue-400">{net.name}</span>
              </div>
              <div className="flex gap-1 items-center">
                {!net.danger && <LockIcon />}
              </div>
            </div>
          ))}
        </div>

        {gameState === 'won' && (
           <div className="absolute inset-0 bg-emerald-950/95 p-6 flex flex-col items-center justify-center text-center z-10 animate-in fade-in">
             <ShieldCheck className="w-16 h-16 text-emerald-400 mb-4" />
             <h3 className="text-2xl font-bold text-emerald-400 mb-2">+200 PTS Ciberseguridad</h3>
             <p className="text-sm text-emerald-100 mb-6 font-medium">Conectarse a un Hotspot (Tethering) celular seguro es 1000 veces más confiable que cualquier red pública.</p>
             <Button onClick={() => window.location.href='/challenges'} className="w-full">Volver a Misiones</Button>
           </div>
        )}

        {gameState === 'lost' && (
           <div className="absolute inset-0 bg-red-950/95 p-6 flex flex-col items-center justify-center text-center z-10 animate-in fade-in">
             <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
             <h3 className="text-2xl font-bold text-red-500 mb-2">Tráfico Interceptado</h3>
             <p className="text-sm text-red-100 mb-6 font-medium">Al conectarte a una red abierta, un atacante capturó tus credenciales en texto plano antes de llegar a los servidores de la empresa. Reprobaste.</p>
             <Button variant="outline" onClick={() => window.location.href='/challenges'} className="w-full text-red-400 border-red-500">Aceptar y Continuar</Button>
           </div>
        )}
      </Card>
    </div>
  );
}

function LockIcon() {
  return <div className="hidden"><Lock className="w-4 h-4"/></div>;
} // Fallback
