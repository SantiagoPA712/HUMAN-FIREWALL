import React, { useEffect, useState } from 'react';
import { Mail, Lock, Wifi, Target, ShieldCheck, Trophy, ArrowLeft, BookOpen, Award, History, Play, Check, Languages } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ThemeToggle } from '../components/ThemeToggle';
import { ThemeSelector } from '../components/ThemeSelector';
import { api } from '../lib/api';
import { useIdioma } from '../context/useIdioma';

export default function ChallengesHub() {
  const { t } = useIdioma();

  // Simulaciones guiadas cargadas en la base.
  //
  // Esta pagina solo mostraba los cinco minijuegos de abajo, que estan escritos
  // a mano en React. Las simulaciones creadas por un instructor desde la API
  // (tablas simulations / simulation_steps / simulation_options) no aparecian
  // en ningun lado, asi que no habia forma de llegar a jugarlas.
  const [simulaciones, setSimulaciones] = useState([]);

  useEffect(() => {
    api.get('/api/simulations')
      .then(({ data }) => setSimulaciones(data))
      // Silencioso: si falla, la pagina sigue mostrando los minijuegos.
      .catch(() => setSimulaciones([]));
  }, []);

  // Se arma en cada render para que los textos se repinten al cambiar de idioma.
  const challenges = [
    {
      id: "phishing",
      icon: <Mail className="w-8 h-8 text-brand-light" />,
      title: t('desafios.phishing_titulo'),
      desc: t('desafios.phishing_desc'),
      level: t('desafios.nivel_facil'),
      levelColor: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
      points: "+100 pts",
      route: "/simulation/phishing"
    },
    {
      id: "password",
      icon: <Lock className="w-8 h-8 text-brand-light" />,
      title: t('desafios.password_titulo'),
      desc: t('desafios.password_desc'),
      level: t('desafios.nivel_medio'),
      levelColor: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
      points: "+150 pts",
      route: "/simulation/password"
    },
    {
      id: "wifi",
      icon: <Wifi className="w-8 h-8 text-brand-light" />,
      title: t('desafios.wifi_titulo'),
      desc: t('desafios.wifi_desc'),
      level: t('desafios.nivel_medio'),
      levelColor: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
      points: "+200 pts",
      route: "/simulation/wifi"
    },
    {
      id: "social",
      icon: <Target className="w-8 h-8 text-brand-light" />,
      title: t('desafios.social_titulo'),
      desc: t('desafios.social_desc'),
      level: t('desafios.nivel_dificil'),
      levelColor: "bg-red-500/20 text-red-400 border border-red-500/30",
      points: "+250 pts",
      route: "/simulation/social"
    },
    {
      id: "data",
      icon: <ShieldCheck className="w-8 h-8 text-brand-light" />,
      title: t('desafios.datos_titulo'),
      desc: t('desafios.datos_desc'),
      level: t('desafios.nivel_medio'),
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
            {t('nav.mi_desempeno')}
          </a>
          <a href="/points" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <History className="w-5 h-5" />
            {t('nav.historial_puntos')}
          </a>
          <a href="/preferencias" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <Languages className="w-5 h-5" />
            {t('nav.preferencias')}
          </a>
          <a href="/challenges" className="flex items-center gap-3 px-4 py-3 rounded-lg bg-brand-blue/10 text-brand-light font-medium">
            <Target className="w-5 h-5" />
            {t('nav.desafios')}
          </a>
          <a href="/rewards" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <Award className="w-5 h-5" />
            {t('nav.mis_logros')}
          </a>
          <a href="/courses" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <BookOpen className="w-5 h-5" />
            {t('nav.cursos')}
          </a>
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <div className="rounded-xl border border-border-color bg-bg-card/40 p-3">
            <span className="text-xs font-semibold text-text-secondary block mb-2">
              {t('nav.tema')}
            </span>
            <ThemeSelector variant="segmented" className="w-full justify-center" />
          </div>

          <button className="flex items-center w-full justify-start px-4 py-3 text-text-secondary hover:text-white hover:bg-red-500/10 hover:border-red-500/50 rounded-lg transition cursor-pointer" onClick={handleLogout}>
            {t('nav.cerrar_sesion')}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 flex flex-col items-center overflow-y-auto">
      
        <div className="w-full max-w-4xl mb-8 flex flex-wrap justify-between items-center gap-3">
          <h1 className="text-3xl font-bold">{t('desafios.disponibles')}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle />
            <Button variant="outline" className="border-border-color hover:bg-nav-hover md:hidden" onClick={() => window.location.href = '/dashboard'}>
              <ArrowLeft className="w-4 h-4 mr-2" /> {t('desafios.menu')}
            </Button>
          </div>
        </div>

        <div className="w-full max-w-4xl space-y-6">

        {/* Simulaciones interactivas: contenido de base de datos, editable por
            un instructor sin tocar codigo. Van primero porque son el formato
            que el sistema esta pensado para escalar; los minijuegos de abajo
            son cinco pantallas fijas. */}
        {simulaciones.length > 0 && (
          <>
            <h2 className="text-xl font-bold flex items-center gap-2 pt-2">
              <Play className="w-5 h-5 text-brand-light" />
              {t('desafios.simulaciones_titulo')}
            </h2>

            {simulaciones.map(sim => (
              <Card key={sim.id} className="p-6 border-l-4 border-l-purple-500 flex flex-col">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-xl font-bold">{sim.title}</h3>
                  {sim.intentada && (
                    <span className="shrink-0 flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-400">
                      <Check className="w-3 h-3" /> {t('desafios.ya_la_hiciste')}
                    </span>
                  )}
                </div>

                {sim.description && (
                  <p className="text-sm text-text-secondary mb-4">{sim.description}</p>
                )}

                <div className="flex justify-between items-center mb-6 text-xs">
                  <span className="px-3 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
                    {sim.difficulty}
                  </span>
                  <span className="text-text-secondary">
                    {sim.pasos} {sim.pasos === 1 ? t('desafios.decision') : t('desafios.decisiones')}
                    {sim.curso && ` · ${sim.curso}`}
                  </span>
                </div>

                <Button
                  className="w-full font-bold bg-purple-600 hover:bg-purple-500"
                  onClick={() => window.location.href = `/simulation/play/${sim.id}`}
                >
                  {sim.intentada ? t('desafios.volver_a_intentar') : t('desafios.comenzar')}
                </Button>
              </Card>
            ))}

            <h2 className="text-xl font-bold pt-6">{t('desafios.minijuegos_titulo')}</h2>
          </>
        )}

        
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
              {t('desafios.comenzar')}
            </Button>
          </Card>
        ))}

        {/* Tabla de Líderes - Widget inferior */}
        <Card className="p-6 mt-12 bg-gradient-to-r from-bg-deep to-[#1a2336] border-t-2 border-t-yellow-500 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            <span className="text-lg font-bold">{t('desafios.tabla_lideres')}</span>
          </div>
          <Button variant="outline" className="border-yellow-500 text-yellow-500 hover:bg-yellow-500/10">
            {t('desafios.ver_ranking')}
          </Button>
        </Card>

        </div>
      </main>
    </div>
  );
}
