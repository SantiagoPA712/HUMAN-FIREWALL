import React from 'react';
import { Mail, Lock, Wifi, Target, ShieldCheck, Trophy, ArrowLeft, BookOpen, Award, History } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export default function ChallengesHub() {
  const challenges = [
    {
      id: "phishing",
      icon: <Mail className="w-8 h-8 text-brand-light" />,
      title: "Detector de Phishing",
      desc: "Aprende a identificar correos fraudulentos y protege tu información",
      level: "Fácil",
      levelColor: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
      points: "+100 pts",
      route: "/simulation/phishing"
    },
    {
      id: "password",
      icon: <Lock className="w-8 h-8 text-brand-light" />,
      title: "Maestro de Contraseñas",
      desc: "Crea contraseñas seguras y aprende mejores prácticas",
      level: "Medio",
      levelColor: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
      points: "+150 pts",
      route: "/simulation/password"
    },
    {
      id: "wifi",
      icon: <Wifi className="w-8 h-8 text-brand-light" />,
      title: "Wi-Fi Seguro",
      desc: "Identifica riesgos en redes inalámbricas públicas",
      level: "Medio",
      levelColor: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
      points: "+200 pts",
      route: "/simulation/wifi"
    },
    {
      id: "social",
      icon: <Target className="w-8 h-8 text-brand-light" />,
      title: "Ingeniería Social",
      desc: "Detecta y previene ataques de manipulación psicológica",
      level: "Difícil",
      levelColor: "bg-red-500/20 text-red-400 border border-red-500/30",
      points: "+250 pts",
      route: "/simulation/social"
    },
    {
      id: "data",
      icon: <ShieldCheck className="w-8 h-8 text-brand-light" />,
      title: "Protección de Datos",
      desc: "Maneja información sensible de forma segura",
      level: "Medio",
      levelColor: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
      points: "+200 pts",
      route: "/simulation/ransomware" // Reutilizamos Ransomware para Datos Críticos
    }
  ];

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-bg-deep text-text-primary flex">
      {/* Sidebar navegacional */}
      <aside className="w-64 border-r border-gray-800 bg-bg-deep/50 flex flex-col p-6 hidden md:flex">
        <div className="flex items-center gap-2 mb-10">
          <ShieldCheck className="w-8 h-8 text-brand-blue" />
          <span className="text-xl font-bold">Human Firewall</span>
        </div>
        
        <nav className="flex-1 flex flex-col gap-2">
          <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <Trophy className="w-5 h-5" />
            Mi Desempeño
          </a>
          <a href="/points" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <History className="w-5 h-5" />
            Historial de Puntos
          </a>
          <a href="/challenges" className="flex items-center gap-3 px-4 py-3 rounded-lg bg-brand-blue/10 text-brand-light font-medium">
            <Target className="w-5 h-5" />
            Desafíos & Retos
          </a>
          <a href="/rewards" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <Award className="w-5 h-5" />
            Mis Logros
          </a>
          <a href="/courses" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <BookOpen className="w-5 h-5" />
            Cursos
          </a>
        </nav>

        <div className="mt-auto">
          <button className="flex items-center w-full justify-start px-4 py-3 text-text-secondary hover:text-white hover:bg-red-500/10 hover:border-red-500/50 rounded-lg transition" onClick={handleLogout}>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 flex flex-col items-center overflow-y-auto">
      
        <div className="w-full max-w-4xl mb-8 flex justify-between items-center">
          <h1 className="text-3xl font-bold">Desafíos Disponibles</h1>
          <Button variant="outline" className="border-gray-700 hover:bg-gray-800 md:hidden" onClick={() => window.location.href = '/dashboard'}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Menú
          </Button>
        </div>

        <div className="w-full max-w-4xl space-y-6">
        
        {challenges.map(chal => (
          <Card key={chal.id} className="p-6 transition-all duration-300 hover:border-brand-blue/50 flex flex-col bg-gradient-to-br from-bg-deep/80 to-brand-blue/5 hover:to-brand-blue/20">
            <div className="mb-4">
              {chal.icon}
            </div>
            
            <h3 className="text-xl font-bold mb-2">{chal.title}</h3>
            <p className="text-sm text-text-secondary mb-6">{chal.desc}</p>
            
            <div className="flex justify-between items-center mb-6">
              <span className={`px-3 py-1 rounded text-xs font-bold ${chal.levelColor}`}>
                {chal.level}
              </span>
              <span className="text-sm font-mono text-brand-light font-bold">
                {chal.points}
              </span>
            </div>
            
            <Button className="w-full font-bold shadow-[0_0_15px_rgba(37,99,235,0.2)]" onClick={() => window.location.href = chal.route}>
              Comenzar
            </Button>
          </Card>
        ))}

        {/* Tabla de Líderes - Widget inferior */}
        <Card className="p-6 mt-12 bg-gradient-to-r from-bg-deep to-[#1a2336] border-t-2 border-t-yellow-500 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            <span className="text-lg font-bold">Tabla de Líderes - Esta Semana</span>
          </div>
          <Button variant="outline" className="border-yellow-500 text-yellow-500 hover:bg-yellow-500/10">
            Ver Ranking
          </Button>
        </Card>

        </div>
      </main>
    </div>
  );
}
