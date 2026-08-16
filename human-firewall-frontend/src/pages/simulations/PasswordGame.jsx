import React, { useState } from 'react';
import { Lock, ShieldCheck, CheckCircle, ArrowLeft } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import axios from 'axios';

export default function PasswordGame() {
  const [password, setPassword] = useState('');
  const [gameState, setGameState] = useState('playing'); // playing, won

  // Lógica simple de fortaleza para el MVP interactivo
  const reqLength = password.length >= 12;
  const reqNumber = /[0-9]/.test(password);
  const reqSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const reqUpper = /[A-Z]/.test(password);
  
  const score = [reqLength, reqNumber, reqSpecial, reqUpper].filter(Boolean).length;
  
  const getStrengthLabel = () => {
    if (score === 0) return { label: "Ingresa una clave", color: "bg-gray-800", text: "text-gray-500" };
    if (score <= 2) return { label: "Débil", color: "bg-red-500", text: "text-red-500" };
    if (score === 3) return { label: "Fuerte", color: "bg-yellow-500", text: "text-yellow-500" };
    return { label: "Inquebrantable", color: "bg-emerald-500", text: "text-emerald-500" };
  };

  const strength = getStrengthLabel();

  const submitPassword = async () => {
    if (score === 4) {
      try {
        const token = localStorage.getItem('token'); 
        if (token) {
           await axios.post('http://localhost:3000/api/gamification/challenge', { challengeId: 'password' }, { headers: { Authorization: `Bearer ${token}` } }).catch(e=>e);
        }
      } finally {
        setGameState('won');
      }
    }
  };

  return (
    <div className="min-h-screen bg-bg-deep text-white p-6 flex flex-col items-center justify-center">
      <Card className="w-full max-w-lg p-8 shadow-[0_0_50px_rgba(37,99,235,0.1)] border-gray-800">
        
        {gameState === 'playing' ? (
          <>
            <div className="flex items-center gap-3 mb-6 border-b border-gray-800 pb-4">
              <Lock className="w-8 h-8 text-brand-blue" />
              <h2 className="text-2xl font-bold">Maestro de Contraseñas</h2>
            </div>
            
            <p className="text-text-secondary mb-8 text-sm">Tu misión es construir una contraseña corporativa que resista un ataque de fuerza bruta moderno.</p>

            <div className="relative mb-6">
              <input 
                type="text" 
                className="w-full bg-gray-900 border-2 border-gray-700 rounded-lg px-4 py-4 text-xl tracking-widest font-mono focus:border-brand-blue focus:outline-none transition"
                placeholder="Escribe aquí..."
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
              <Requirement check={reqLength} text="Al menos 12 caracteres (ideal >15)" />
              <Requirement check={reqUpper} text="Contiene letras MAYÚSCULAS" />
              <Requirement check={reqNumber} text="Contiene números (0-9)" />
              <Requirement check={reqSpecial} text="Contiene símbolos (!@#$%^&*)" />
            </div>

            <Button 
              className={`w-full py-4 text-lg font-bold ${score === 4 ? 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]' : 'opacity-50 cursor-not-allowed'}`}
              onClick={submitPassword}
              disabled={score !== 4}
            >
              Registrar Contraseña Segura
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center text-center animate-in zoom-in py-8">
             <CheckCircle className="w-20 h-20 text-emerald-500 mb-6" />
             <h3 className="text-3xl font-bold mb-4">¡Invulnerable!</h3>
             <p className="text-text-secondary mb-8">Tu contraseña tomaría aproximadamente 400 billones de años en ser hackeada por las supercomputadoras actuales.</p>
             <div className="bg-emerald-900/30 border border-emerald-500/50 text-emerald-400 font-bold px-6 py-3 rounded-full mb-8">
               +150 PTS Ciberseguridad
             </div>
             <Button onClick={() => window.location.href='/challenges'} variant="outline" className="w-full">Volver al Dashboard</Button>
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
