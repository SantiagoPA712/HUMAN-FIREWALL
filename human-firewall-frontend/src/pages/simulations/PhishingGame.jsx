import React, { useState } from 'react';
import { ShieldAlert, CheckCircle, Mail, Paperclip, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { registrarDesafio } from '../../lib/api';
import { usePuntos } from '../../context/PuntosContext';
import { Button } from '../../components/ui/Button';

export default function PhishingGame() {
  const [gameState, setGameState] = useState('playing'); // 'playing', 'won', 'lost'
  const [puntosGanados, setPuntosGanados] = useState(0);
  const { notificarPuntos } = usePuntos();

  const handleDecision = async (decision) => {
    const acerto = decision === 'report';
    setGameState(acerto ? 'won' : 'lost');

    // El intento se registra tambien al fallar: antes la pantalla hacia
    // `return` sin avisarle a nadie, y el error no quedaba en el historial,
    // asi que nunca aparecia como area de oportunidad.
    // Los puntos los define la base (challenges.points_reward), no la pantalla.
    const data = await registrarDesafio('phishing', acerto);
    if (data?.puntos_estimados > 0) {
      setPuntosGanados(data.puntos_estimados);
      notificarPuntos(data.puntos_estimados, 'Detector de Phishing');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8 flex flex-col items-center">
      
      <div className="w-full max-w-4xl mb-6 flex justify-between items-center">
        <Button variant="outline" className="border-gray-700" onClick={() => window.location.href = '/dashboard'}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Salir de la simulación
        </Button>
        <div className="bg-brand-blue/20 text-brand-light px-4 py-2 rounded-full font-bold shadow-[0_0_15px_rgba(37,99,235,0.3)]">
          Simulación en Vivo: Phishing Nivel 1
        </div>
      </div>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Cliente de Correo Simulado */}
        <Card className="md:col-span-2 overflow-hidden bg-white text-gray-900 shadow-2xl shadow-black/50">
          <div className="bg-gray-100 border-b border-gray-300 p-4 flex gap-4 items-center">
            <div className="w-3 h-3 rounded-full bg-red-400"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
            <div className="w-3 h-3 rounded-full bg-green-400"></div>
            <span className="text-gray-500 font-medium text-sm ml-4">EmpresaMail Pro</span>
          </div>

          <div className="p-6">
            <div className="flex items-start justify-between border-b border-gray-200 pb-4 mb-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl">
                  RR
                </div>
                <div>
                  <h3 className="font-bold text-lg">Recursos Humanos <span className="font-normal text-gray-500 text-sm">&lt;hr-empresa-updates@admin-portal-login.com&gt;</span></h3>
                  <p className="text-gray-600 text-sm">Para: ti@empresa.com</p>
                </div>
              </div>
              <span className="text-gray-500 text-sm">Hace 5 min</span>
            </div>

            <h2 className="text-2xl font-bold mb-4">URGENTE: Actualización obligatoria de política de aguinaldos</h2>
            <div className="text-gray-800 space-y-4 mb-8">
              <p>Estimado empleado,</p>
              <p>El departamento de Recursos Humanos ha emitido un nuevo formato obligatorio para el pago de aguinaldos y bonos de este trimestre.</p>
              <p>Si no llenas el formulario adjunto en las próximas <strong>24 horas</strong>, tu bono será suspendido de forma indefinida.</p>
              <p>Por favor, descarga el documento protegido a continuación, ingresa tus credenciales del portal y envíalo firmado a la brevedad.</p>
              <p>Atentamente,<br/>El equipo de RRHH</p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col md:flex-row items-center gap-4 mb-4">
              <div className="bg-red-100 p-3 rounded-lg text-red-600">
                <Paperclip className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Formulario_Aguinaldo_Final.pdf.exe</h4>
                <p className="text-sm text-gray-500">Documento Cifrado (1.4 MB)</p>
              </div>
              <div className="ml-auto flex gap-2">
                <button 
                  onClick={() => handleDecision('download')}
                  className="bg-blue-600 text-white px-4 py-2 rounded font-bold hover:bg-blue-700 transition"
                  disabled={gameState !== 'playing'}
                >
                  Descargar Adjunto
                </button>
              </div>
            </div>
            
          </div>
        </Card>

        {/* Panel Investigativo del Usuario */}
        <div className="flex flex-col gap-4">
          <Card className="p-6 bg-bg-deep border-gray-800">
            <h3 className="text-xl font-bold mb-4 text-white">Tu Misión</h3>
            <p className="text-text-secondary text-sm mb-6">Analiza cuidadosamente este correo recibido. Tienes dos opciones principales como empleado. ¿Qué acción tomarás para proteger la red de la empresa?</p>
            
            <div className="flex flex-col gap-3">
              <Button 
                onClick={() => handleDecision('report')} 
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                disabled={gameState !== 'playing'}
              >
                <ShieldAlert className="w-4 h-4 mr-2" />
                Reportar correo como Phishing
              </Button>
              <Button 
                variant="outline" 
                onClick={() => handleDecision('ignore')}
                disabled={gameState !== 'playing'}
              >
                Ignorar y Eliminar
              </Button>
            </div>
          </Card>

          {gameState === 'won' && (
            <Card className="p-6 bg-gradient-to-br from-emerald-900/50 to-emerald-600/20 border-emerald-500/50 flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-5">
              <CheckCircle className="w-16 h-16 text-emerald-400 mb-4" />
              <h3 className="text-xl font-bold text-emerald-300 mb-2">¡Misión Cumplida!</h3>
              <p className="text-sm text-emerald-100 mb-4">Detectaste el remitente sospechoso y la doble extensión (.pdf.exe). Acabas de proteger a toda la compañía.</p>
              <div className="bg-emerald-950 px-4 py-2 rounded-full font-bold text-emerald-400 mb-4">+{puntosGanados} Puntos de Seguridad</div>
              <Button onClick={() => window.location.href = '/dashboard'} className="w-full bg-emerald-500 hover:bg-emerald-400">Volver al Dashboard</Button>
            </Card>
          )}

          {gameState === 'lost' && (
            <Card className="p-6 bg-gradient-to-br from-red-900/50 to-red-600/20 border-red-500/50 flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-5">
              <AlertTriangle className="w-16 h-16 text-red-500 mb-4 animate-bounce" />
              <h3 className="text-xl font-bold text-red-400 mb-2">Incidente Crítico</h3>
              <p className="text-sm text-red-100 mb-4">Descargaste malware. Fíjate en el correo del remitente: era un portal falso (`admin-portal-login.com`), no el oficial de la empresa.</p>
              <div className="bg-red-950 px-4 py-2 rounded-full font-bold text-red-400 mb-3">0 Puntos obtenidos</div>
              <p className="mb-4 text-xs text-red-200">El intento quedó registrado en <strong>Mi desempeño</strong>.</p>
              <Button onClick={() => window.location.href = '/performance'} variant="outline" className="w-full border-red-500 text-red-400 hover:bg-red-500/10">Ver qué repasar</Button>
            </Card>
          )}
        </div>

      </div>
    </div>
  );
}
