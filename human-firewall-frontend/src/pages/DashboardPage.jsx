import React, { useEffect, useState } from 'react';
import { ShieldCheck, BookOpen, Target, Trophy, LogOut, Award, History, Shield } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PointsWidget } from '../components/PointsWidget';
import { LevelBadge } from '../components/LevelBadge';
import { usePuntos } from '../context/PuntosContext';

export default function DashboardPage() {
  const [userName, setUserName] = useState("Admin");
  const { recompensas, nivel } = usePuntos();
  
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
          <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 rounded-lg bg-brand-blue/10 text-brand-light font-medium">
            <Trophy className="w-5 h-5" />
            Mi Desempeño
          </a>
          <a href="/level" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <Shield className="w-5 h-5" />
            Mi Nivel
          </a>
          <a href="/points" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <History className="w-5 h-5" />
            Historial de Puntos
          </a>
          <a href="/challenges" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
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
          <Button variant="outline" className="w-full justify-start text-text-secondary border-gray-700 hover:text-white hover:bg-red-500/10 hover:border-red-500/50" onClick={handleLogout}>
            <LogOut className="w-5 h-5 mr-2" />
            Cerrar Sesión
          </Button>
        </div>
      </aside>

      {/* Contenido Principal */}
      <main className="flex-1 p-10 overflow-y-auto">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Bienvenido, {userName}</h1>
            <p className="text-text-secondary mt-1">Aquí está el resumen de tu ciber-entrenamiento.</p>
          </div>
          <div className="flex items-center gap-4">
            <PointsWidget compacto />
            {/* El nivel salia fijo en "Cinturón Blanco" / 1 para todo el mundo
                porque users.level nunca se calculaba (deuda tecnica 9).
                Ahora viene derivado de points_ledger + levels_config. */}
            <a href="/level" title="Ver mi nivel">
              <LevelBadge nivel={nivel} compacto />
            </a>
          </div>
        </header>

        {/* Widgets Gamificación (Epic 6 & 7) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <Card className="p-6">
            <PointsWidget />
          </Card>
          
          {/* Reemplaza a "Simulaciones Fallidas", que mostraba un 0 fijo
              escrito a mano y no se calculaba de ningun lado. */}
          <Card className="p-6">
            <LevelBadge nivel={nivel} />
            <a href="/level" className="mt-3 block text-sm text-brand-light hover:underline">
              Ver mi nivel
            </a>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-brand-dark/40 to-brand-blue/20">
            <h3 className="text-lg font-bold mb-2 text-brand-light">Insignias Ganadas</h3>
            {recompensas.length === 0 ? (
              <span className="text-sm text-text-secondary">Aún no tienes insignias. ¡Completa tu primera lección!</span>
            ) : (
              <>
                <div className="text-4xl font-black text-brand-light mb-2">{recompensas.length}</div>
                <div className="flex flex-wrap gap-1 text-xs text-text-secondary">
                  {recompensas.slice(0, 3).map(r => (
                    <span key={r.id} className="rounded-full border border-brand-blue/40 px-2 py-0.5">
                      {r.reward_name}
                    </span>
                  ))}
                  {recompensas.length > 3 && <span className="px-1">+{recompensas.length - 3}</span>}
                </div>
              </>
            )}
            <a href="/rewards" className="mt-3 block text-sm text-brand-light hover:underline">
              Ver mis logros
            </a>
          </Card>
        </div>

        {/* Cursos Pendientes (Epic 3) */}
        <h2 className="text-2xl font-bold mb-6">Tus Tareas Pendientes</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6 flex flex-col justify-between border-l-4 border-l-brand-blue">
            <div>
              <div className="flex items-center gap-2 text-brand-light mb-2">
                <BookOpen className="w-5 h-5" />
                <span className="text-sm font-semibold uppercase tracking-wider">Módulo de Curso</span>
              </div>
              <h3 className="text-xl font-bold mb-2">Introducción al Phishing</h3>
              <p className="text-sm text-text-secondary line-clamp-2 mb-6">Aprende a detectar los correos electrónicos más peligrosos que pueden comprometer a tu empresa.</p>
            </div>
            <Button className="w-full" onClick={() => window.location.href = '/simulation/phishing'}>Comenzar Módulo</Button>
          </Card>

          <Card className="p-6 flex flex-col justify-between border-l-4 border-l-purple-500">
            <div>
              <div className="flex items-center gap-2 text-purple-400 mb-2">
                <Target className="w-5 h-5" />
                <span className="text-sm font-semibold uppercase tracking-wider">Simulación Interactiva</span>
              </div>
              <h3 className="text-xl font-bold mb-2">Ransomware en Acción</h3>
              <p className="text-sm text-text-secondary line-clamp-2 mb-6">Experimenta un ataque simulado de secuestro de datos. ¿Tomarás la decisión correcta?</p>
            </div>
            <Button className="w-full bg-purple-600 hover:bg-purple-500 hover:shadow-purple-500/30" onClick={() => window.location.href = '/simulation/ransomware'}>Lanzar Simulación</Button>
          </Card>
        </div>

      </main>
    </div>
  );
}
