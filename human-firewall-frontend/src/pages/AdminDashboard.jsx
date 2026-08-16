import React, { useState } from 'react';
import { ShieldCheck, Users, Activity, AlertTriangle, ArrowRight, BookOpen } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  // Mocks de datos de la empresa
  const metrics = {
    totalEmployees: 428,
    activeSimulations: 3,
    globalRiskScore: "Alto",
    failedPhishing: 12
  };

  const users = [
    { id: 1, name: "María González", email: "maria.g@empresa.com", role: "Ventas", risk: "Critico", points: 20 },
    { id: 2, name: "Carlos López", email: "carlos.l@empresa.com", role: "Soporte", risk: "Bajo", points: 450 },
    { id: 3, name: "Ana Ruiz", email: "ana.r@empresa.com", role: "Finanzas", risk: "Medio", points: 120 }
  ];

  return (
    <div className="min-h-screen bg-bg-deep text-text-primary flex">
      {/* Sidebar Admin */}
      <aside className="w-64 border-r border-gray-800 bg-bg-deep/50 flex flex-col p-6 hidden md:flex">
        <div className="flex items-center gap-2 mb-10">
          <ShieldCheck className="w-8 h-8 text-brand-blue" />
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">Security CISO</span>
        </div>
        
        <nav className="flex-1 flex flex-col gap-2">
          <button onClick={() => setActiveTab('overview')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left ${activeTab==='overview' ? 'bg-brand-blue/10 text-brand-light' : 'text-text-secondary hover:bg-gray-800'}`}>
            <Activity className="w-5 h-5" />
            Visión Global
          </button>
          <button onClick={() => setActiveTab('users')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left ${activeTab==='users' ? 'bg-brand-blue/10 text-brand-light' : 'text-text-secondary hover:bg-gray-800'}`}>
            <Users className="w-5 h-5" />
            Directorio y Riesgos
          </button>
        </nav>

        <div className="mt-auto">
          <Button variant="outline" className="w-full justify-center text-text-secondary border-gray-700" onClick={() => window.location.href = '/dashboard'}>
            Salir a Modo Empleado
          </Button>
        </div>
      </aside>

      {/* Contenido */}
      <main className="flex-1 p-10 overflow-y-auto bg-gradient-to-b from-bg-deep to-gray-900/50">
        
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Panel Administrativo de Ciberseguridad</h1>
          <p className="text-text-secondary">Monitorea el nivel real de la coraza humana de tu organización.</p>
        </header>

        {activeTab === 'overview' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="p-6 border-t-2 border-t-brand-blue">
                <p className="text-sm text-text-secondary mb-1">Empleados Registrados</p>
                <div className="text-3xl font-bold">{metrics.totalEmployees}</div>
              </Card>
              <Card className="p-6 border-t-2 border-t-emerald-500">
                <p className="text-sm text-text-secondary mb-1">Simulaciones Activas</p>
                <div className="text-3xl font-bold">{metrics.activeSimulations}</div>
              </Card>
              <Card className="p-6 border-t-2 border-t-red-500">
                <p className="text-sm text-text-secondary mb-1">Nivel Global de Riesgo</p>
                <div className="text-3xl font-bold text-red-500">{metrics.globalRiskScore}</div>
              </Card>
              <Card className="p-6 border-t-2 border-t-yellow-500">
                <p className="text-sm text-text-secondary mb-1">Caídos en Phishing hoy</p>
                <div className="text-3xl font-bold text-yellow-500">{metrics.failedPhishing}</div>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Card className="p-6">
                <h3 className="font-bold flex items-center gap-2 mb-4"><AlertTriangle className="text-yellow-500 w-5 h-5"/> Usuarios de Alto Riesgo</h3>
                <div className="space-y-4">
                  {users.filter(u => u.risk === "Critico" || u.risk === "Medio").map(user => (
                    <div key={user.id} className="flex justify-between items-center border-b border-gray-800 pb-2">
                       <div>
                         <p className="font-bold">{user.name}</p>
                         <p className="text-xs text-gray-500">{user.email} - Depto: {user.role}</p>
                       </div>
                       <Button variant="outline" className="h-8 text-xs bg-brand-blue/10 border-brand-blue/30 text-brand-light">Asignar Curso Urgente</Button>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                 <h3 className="font-bold mb-4 flex items-center gap-2"><Activity className="text-brand-blue w-5 h-5"/> Últimas Acciones del Sistema</h3>
                 <div className="space-y-4 text-sm text-gray-300">
                   <p className="border-l-2 border-emerald-500 pl-3"><strong>Hace 5 min:</strong> Carlos López superó el curso "Prevención de Ransomware".</p>
                   <p className="border-l-2 border-red-500 pl-3"><strong>Hace 12 min:</strong> María González falló en la simulación "Facturacion Falsa".</p>
                   <p className="border-l-2 border-brand-blue pl-3"><strong>Hace 1 hora:</strong> RRHH subió a 4 nuevos empleados al sistema.</p>
                 </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <Card className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg">Directorio de Empleados</h3>
              <Button>Inscribir Empleado</Button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400 text-sm">
                    <th className="p-3 font-medium">Nombre</th>
                    <th className="p-3 font-medium">Rol / Depto</th>
                    <th className="p-3 font-medium">Nivel Riesgo</th>
                    <th className="p-3 font-medium">Puntos Security</th>
                    <th className="p-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="p-3">
                        <p className="font-bold">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </td>
                      <td className="p-3 text-sm">{user.role}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          user.risk === 'Critico' ? 'bg-red-500/20 text-red-400' :
                          user.risk === 'Medio' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {user.risk}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-brand-light">{user.points}</td>
                      <td className="p-3 text-right">
                        <Button variant="outline" className="border-gray-600 text-xs py-1 h-8">Ver Perfil</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </Card>
        )}

      </main>
    </div>
  );
}
