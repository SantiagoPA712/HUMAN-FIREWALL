import React, { useState, useEffect } from 'react';
import { ShieldCheck, Skull, HardDrive, AlertTriangle, FileText, ImageIcon, Settings, Lock } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { api } from '../../lib/api';
import { usePuntos } from '../../context/PuntosContext';
import { Button } from '../../components/ui/Button';

export default function RansomwareGame() {
  const [gameState, setGameState] = useState('exploring'); // 'exploring', 'infected', 'won', 'lost'
  const [timer, setTimer] = useState(60);
  const [puntosGanados, setPuntosGanados] = useState(0);
  const { notificarPuntos } = usePuntos();

  // Efecto del tiempo cuando está infectado
  useEffect(() => {
    let interval;
    if (gameState === 'infected' && timer > 0) {
      interval = setInterval(() => setTimer(t => t - 1), 1000);
    } else if (timer === 0 && gameState === 'infected') {
      setGameState('lost');
    }
    return () => clearInterval(interval);
  }, [gameState, timer]);

  const triggerInfection = () => {
    setGameState('infected');
  };

  const handleDecision = async (decision) => {
    if (decision !== 'disconnect') {
      setGameState('lost'); // Pagar o esperar = fallo
      return;
    }

    setGameState('won');

    try {
      const { data } = await api.post('/api/gamification/challenge', { challengeId: 'data' });
      setPuntosGanados(data.puntos_estimados);
      notificarPuntos(data.puntos_estimados, 'Proteccion de Datos');
    } catch (e) {
      console.warn('No se pudieron registrar los puntos:', e.response?.data?.msg || e.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8 flex flex-col items-center relative overflow-hidden">
      
      {/* Glitch Overlay Effect during infection */}
      {gameState === 'infected' && (
        <div className="absolute inset-0 bg-red-900/10 pointer-events-none z-50 mix-blend-color-burn animate-pulse"></div>
      )}

      {/* Header */}
      <div className="w-full max-w-5xl mb-6 flex justify-between items-center z-10">
        <Button variant="outline" className="border-gray-700 bg-black" onClick={() => window.location.href = '/dashboard'}>
          Salir a zona segura
        </Button>
        <div className="bg-purple-900/50 text-purple-300 px-4 py-2 rounded-full font-bold border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]">
          Laboratorio de Amenazas: Ransomware
        </div>
      </div>

      {(gameState === 'exploring') && (
        <div className="w-full max-w-5xl bg-[#1E1E1E] rounded-xl shadow-2xl shadow-black overflow-hidden flex flex-col h-[70vh] border border-gray-700">
          <div className="bg-gray-800 p-3 border-b border-gray-700 flex justify-between items-center">
            <span className="text-gray-300 font-medium">Explorador de Archivos Corporativo</span>
          </div>
          <div className="flex flex-1 p-6 gap-6">
            <div className="w-1/4 border-r border-gray-700 pr-4 space-y-4">
               <div className="flex items-center gap-2 text-gray-300 hover:text-white cursor-pointer"><HardDrive className="w-4 h-4"/> Disco Local (C:)</div>
               <div className="flex items-center gap-2 text-brand-blue font-bold pl-4"><FileText className="w-4 h-4"/> Documentos Confidenciales</div>
            </div>
            <div className="flex-1 grid grid-cols-4 gap-6 auto-rows-min">
              {['Presupuesto_2026.xlsx', 'Planos_Ingenieria.dwg', 'Bases_Datos_Clientes.db'].map(file => (
                <div key={file} className="flex flex-col items-center gap-2 cursor-pointer p-4 rounded-lg hover:bg-gray-800">
                  <FileText className="w-10 h-10 text-brand-light" />
                  <span className="text-xs text-center break-words w-full">{file}</span>
                </div>
              ))}
              <div 
                className="flex flex-col items-center gap-2 cursor-pointer p-4 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 group"
                onClick={triggerInfection}
              >
                <Settings className="w-10 h-10 text-red-500 group-hover:animate-spin" />
                <span className="text-xs text-center text-red-400 font-bold">Instalador_Adobe_Crack.exe</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'infected' && (
        <div className="w-full max-w-4xl bg-red-950 border-4 border-red-600 rounded-xl p-8 flex flex-col items-center text-center shadow-[0_0_100px_rgba(220,38,38,0.5)] z-20 animate-in zoom-in duration-300">
          <Skull className="w-24 h-24 text-red-500 mb-6 animate-pulse" />
          <h1 className="text-5xl font-black text-red-500 tracking-wider mb-4">YOUR_FILES_ARE_ENCRYPTED</h1>
          <p className="text-xl text-red-200 mb-8 max-w-2xl">
            Toda tu red y archivos corporativos han sido cifrados usando cifrado militar RSA-2048. 
            Si intentas apagar la computadora, perderás todo para siempre.
          </p>

          <div className="bg-black border border-red-600 p-6 rounded-lg mb-8 w-full max-w-md">
            <h3 className="text-red-500 font-bold uppercase tracking-widest text-sm mb-2">Tiempo restante</h3>
            <div className="text-6xl font-mono text-white">
              00:00:{timer.toString().padStart(2, '0')}
            </div>
            <p className="text-gray-500 mt-2 text-sm">El precio en Bitcoin se duplicará cuando el reloj llegue a 0.</p>
          </div>

          <div className="flex flex-col md:flex-row gap-4 w-full max-w-2xl justify-center">
            <Button className="bg-green-600 hover:bg-green-500 text-white flex-1 py-6 text-lg font-bold" onClick={() => handleDecision('pay')}>
              Pagar $50,000 en Bitcoin
            </Button>
            <Button variant="outline" className="border-red-500 text-red-500 hover:bg-red-900 flex-1 py-6 text-lg font-bold" onClick={() => handleDecision('disconnect')}>
              Desconectar cable de Red
            </Button>
          </div>
        </div>
      )}

      {gameState === 'won' && (
        <Card className="max-w-2xl w-full p-10 bg-gradient-to-br from-emerald-900/50 to-emerald-600/20 border-emerald-500/50 flex flex-col items-center text-center animate-in fade-in z-20">
          <ShieldCheck className="w-20 h-20 text-emerald-400 mb-6" />
          <h3 className="text-3xl font-bold text-emerald-300 mb-4">¡Excelente Reacción!</h3>
          <p className="text-lg text-emerald-100 mb-6">Al desconectar el cable de red o apagar el Wi-Fi inmediatamente, evitaste que el Ransomware continuara cifrando los archivos de red y los servidores principales de la empresa.</p>
          <div className="bg-emerald-950 px-6 py-3 rounded-full font-bold text-emerald-400 text-xl mb-8">+{puntosGanados} Puntos de Seguridad</div>
          <Button onClick={() => window.location.href = '/dashboard'} className="w-full bg-emerald-500 hover:bg-emerald-400">Excelente. Volver al Dashboard</Button>
        </Card>
      )}

      {gameState === 'lost' && (
        <Card className="max-w-2xl w-full p-10 bg-gradient-to-br from-red-900/50 to-red-600/20 border-red-500/50 flex flex-col items-center text-center animate-in fade-in z-20">
          <Lock className="w-20 h-20 text-red-500 mb-6" />
          <h3 className="text-3xl font-bold text-red-400 mb-4">Totalmente Comprometido</h3>
          <p className="text-lg text-red-100 mb-6">Pagar a un atacante JAMÁS asegura la devolución de los archivos, y te marca como un objetivo fácil para el futuro. Además, dejaste la máquina conectada a la red permitiendo que la infección se esparciera.</p>
          <div className="bg-red-950 px-6 py-3 rounded-full font-bold text-red-400 text-xl mb-8">Pésima decisión. -50 Puntos</div>
          <Button onClick={() => window.location.href = '/dashboard'} variant="outline" className="w-full border-red-500 text-red-500 hover:bg-red-900">Aprender del error (Dashboard)</Button>
        </Card>
      )}

    </div>
  );
}
