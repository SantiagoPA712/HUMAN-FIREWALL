import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, BookOpen, Target, Trophy, LogOut, Award,
  History, Shield, TrendingUp, BarChart3, ShieldAlert,
  RefreshCw, Settings, Users, AlertTriangle, Eye, EyeOff,
  MoveUp, MoveDown, CheckCircle2, ChevronRight
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PointsWidget } from '../components/PointsWidget';
import { LevelBadge } from '../components/LevelBadge';
import { usePuntos } from '../context/PuntosContext';
import { getUsuarioActual, getDashboard, saveDashboardConfig } from '../lib/api';

export default function DashboardPage() {
  const { nivel } = usePuntos();
  const usuario = getUsuarioActual();

  const [dashboardData, setDashboardData] = useState({
    polling_interval_seconds: 300,
    widgets: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configWidgets, setConfigWidgets] = useState([]);
  const [savingConfig, setSavingConfig] = useState(false);

  // Carga de datos del Dashboard centralizado
  const cargarDashboard = useCallback(async (isPolling = false) => {
    try {
      if (!isPolling) setLoading(true);
      const data = await getDashboard();
      setDashboardData(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Error al cargar dashboard:', err);
      setError('No se pudo actualizar el dashboard');
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, []);

  // Polling dinamico configurado segun polling_interval_seconds entregado por el backend
  useEffect(() => {
    cargarDashboard(false);

    const intervaloSegundos = dashboardData.polling_interval_seconds || 300;
    const intervalId = setInterval(() => {
      cargarDashboard(true);
    }, intervaloSegundos * 1000);

    return () => clearInterval(intervalId);
  }, [cargarDashboard, dashboardData.polling_interval_seconds]);

  // Inicializar estado de configuracion
  const handleOpenConfig = () => {
    setConfigWidgets(
      dashboardData.widgets.map(w => ({
        widget_id: w.id,
        title: w.title,
        visible: true,
        order: w.order || 1
      }))
    );
    setShowConfigModal(true);
  };

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      await saveDashboardConfig(configWidgets);
      setShowConfigModal(false);
      await cargarDashboard(false);
    } catch (err) {
      alert(err.response?.data?.msg || 'Error al guardar la configuración');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleVisible = (widgetId) => {
    setConfigWidgets(prev =>
      prev.map(w => w.widget_id === widgetId ? { ...w, visible: !w.visible } : w)
    );
  };

  const handleMoveOrder = (index, direction) => {
    const newWidgets = [...configWidgets];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newWidgets.length) return;

    const temp = newWidgets[index];
    newWidgets[index] = newWidgets[targetIndex];
    newWidgets[targetIndex] = temp;

    // Reasignar orden 1..N
    newWidgets.forEach((w, i) => { w.order = i + 1; });
    setConfigWidgets(newWidgets);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.href = '/login';
  };

  // ---------------------------------------------------------------------------
  // Renderizadores de Widgets (Sin lógica de filtrado por rol en frontend)
  // El frontend renderiza 100% lo que el backend autorizó y envió en el payload.
  // ---------------------------------------------------------------------------

  const renderWidgetContent = (widget) => {
    const { id, data } = widget;

    if (!data) {
      return (
        <div className="p-4 text-sm text-text-secondary">
          No hay datos disponibles para este widget.
        </div>
      );
    }

    switch (id) {
      case 'my_progress':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-800/40 p-4 rounded-lg">
                <span className="text-xs text-text-secondary uppercase tracking-wider font-semibold">Puntos y Nivel</span>
                <div className="mt-2 flex items-center justify-between">
                  <PointsWidget compacto />
                  <LevelBadge nivel={data.nivel?.nivel_actual || nivel} compacto />
                </div>
              </div>
              <div className="bg-gray-800/40 p-4 rounded-lg">
                <span className="text-xs text-text-secondary uppercase tracking-wider font-semibold">Insignias Obtenidas</span>
                <div className="mt-2 flex items-center gap-2">
                  <Award className="w-6 h-6 text-brand-light" />
                  <span className="text-2xl font-bold">{Array.isArray(data.insignias) ? data.insignias.length : 0}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-4 text-xs">
              <a href="/level" className="text-brand-light hover:underline flex items-center gap-1">
                Ver detalle de nivel <ChevronRight className="w-3 h-3" />
              </a>
              <a href="/rewards" className="text-brand-light hover:underline flex items-center gap-1">
                Ver mis logros <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        );

      case 'leaderboard':
        return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-text-secondary uppercase border-b border-gray-800">
                <tr>
                  <th className="py-2">Pos</th>
                  <th className="py-2">Usuario</th>
                  <th className="py-2">Equipo</th>
                  <th className="py-2 text-right">Puntos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {Array.isArray(data) && data.slice(0, 5).map((user, idx) => (
                  <tr key={user.id} className="hover:bg-gray-800/20">
                    <td className="py-2 font-bold text-brand-light">#{idx + 1}</td>
                    <td className="py-2 text-text-primary">{user.email}</td>
                    <td className="py-2 text-text-secondary">{user.team_name || 'General'}</td>
                    <td className="py-2 text-right font-bold">{user.total_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'organizational_overview':
        return (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-800/40 p-4 rounded-lg">
              <div className="flex items-center gap-2 text-text-secondary text-xs uppercase">
                <Users className="w-4 h-4 text-brand-light" />
                Equipos Activos
              </div>
              <div className="text-2xl font-bold mt-1">
                {Array.isArray(data.equipos) ? data.equipos.length : 0}
              </div>
            </div>
            <div className="bg-gray-800/40 p-4 rounded-lg">
              <div className="flex items-center gap-2 text-text-secondary text-xs uppercase">
                <BookOpen className="w-4 h-4 text-brand-light" />
                Cursos Disponibles
              </div>
              <div className="text-2xl font-bold mt-1">
                {Array.isArray(data.cursos) ? data.cursos.length : 0}
              </div>
            </div>
            <div className="col-span-2 text-xs">
              <a href="/reports" className="text-brand-light hover:underline flex items-center gap-1">
                Ir al panel de reportes organizacionales <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        );

      case 'performance_metrics':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-gray-800/40 p-3 rounded-lg">
                <div className="text-xs text-text-secondary">Usuarios</div>
                <div className="text-xl font-bold mt-1">{data.total_usuarios || 0}</div>
              </div>
              <div className="bg-gray-800/40 p-3 rounded-lg">
                <div className="text-xs text-text-secondary">Prom. Puntos</div>
                <div className="text-xl font-bold mt-1">{data.agregados?.promedio_puntos || 0}</div>
              </div>
              <div className="bg-gray-800/40 p-3 rounded-lg">
                <div className="text-xs text-text-secondary">Aprobación</div>
                <div className="text-xl font-bold mt-1">{data.agregados?.tasa_aprobacion_promedio || '0%'}</div>
              </div>
            </div>
            <div className="text-xs">
              <a href="/reports" className="text-brand-light hover:underline flex items-center gap-1">
                Ver reporte detallado de desempeño RH <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        );

      case 'security_anomalies':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-red-500/10 border border-red-500/30 p-2 rounded">
                <div className="text-red-400 font-bold">Críticas</div>
                <div className="text-lg font-bold text-white mt-1">{data.resumen?.por_severidad?.CRITICAL || 0}</div>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/30 p-2 rounded">
                <div className="text-amber-400 font-bold">Altas</div>
                <div className="text-lg font-bold text-white mt-1">{data.resumen?.por_severidad?.HIGH || 0}</div>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/30 p-2 rounded">
                <div className="text-blue-400 font-bold">Abiertas</div>
                <div className="text-lg font-bold text-white mt-1">{data.resumen?.por_estado?.open || 0}</div>
              </div>
            </div>
            <div className="text-xs">
              <a href="/security" className="text-red-400 hover:underline flex items-center gap-1">
                Abrir centro de control de anomalías <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        );

      case 'audit_log':
        return (
          <div className="space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-text-secondary uppercase border-b border-gray-800">
                  <tr>
                    <th className="py-1">Actor</th>
                    <th className="py-1">Tipo</th>
                    <th className="py-1">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/40">
                  {Array.isArray(data) && data.slice(0, 3).map((item) => (
                    <tr key={item.id}>
                      <td className="py-1.5 text-text-secondary truncate max-w-[120px]">{item.actor_email}</td>
                      <td className="py-1.5 font-medium">{item.change_type}</td>
                      <td className="py-1.5 text-text-secondary truncate max-w-[140px]">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs">
              <a href="/security" className="text-brand-light hover:underline flex items-center gap-1">
                Ver historial de auditoría completo <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        );

      default:
        return (
          <div className="p-4 text-xs text-text-secondary">
            {JSON.stringify(data, null, 2)}
          </div>
        );
    }
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
            Panel
          </a>
          <a href="/performance" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <TrendingUp className="w-5 h-5" />
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
          <a href="/security" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <ShieldAlert className="w-5 h-5" />
            Seguridad
          </a>
          <a href="/reports" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <BarChart3 className="w-5 h-5" />
            Reportes
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
        <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Dashboard Centralizado
            </h1>
            <p className="text-text-secondary mt-1">
              Sesión iniciada como <span className="font-semibold text-brand-light">{usuario?.role || 'empleado'}</span>. Resumen integral de plataforma.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-text-secondary hidden sm:inline">
                Actualizado: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => cargarDashboard(false)}
              className="border-gray-700 text-text-secondary hover:text-white"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refrescar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenConfig}
              className="border-gray-700 text-text-secondary hover:text-white"
            >
              <Settings className="w-4 h-4 mr-1" />
              Configurar Widgets
            </Button>
          </div>
        </header>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* Renderizado Dinámico de Widgets Entregados y Filtrados por Backend */}
        {/* ------------------------------------------------------------------- */}
        {loading && dashboardData.widgets.length === 0 ? (
          <div className="p-12 text-center text-text-secondary">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-brand-blue" />
            Cargando widgets del dashboard...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {dashboardData.widgets.map((widget) => (
              <Card key={widget.id} className="p-6 flex flex-col justify-between border-gray-800 bg-gray-900/50 hover:border-gray-700 transition-colors">
                <div>
                  <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800/80">
                    <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-brand-blue"></span>
                      {widget.title}
                    </h2>
                    <span className="text-xs uppercase tracking-wider text-text-secondary px-2 py-0.5 rounded bg-gray-800/60">
                      {widget.resource}
                    </span>
                  </div>

                  {renderWidgetContent(widget)}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Modal de Personalización de Widgets (PUT /api/gamification/dashboard/config) */}
        {showConfigModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-md w-full p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
                <h3 className="text-lg font-bold">Personalizar Widgets</h3>
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="text-text-secondary hover:text-white"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-text-secondary mb-4">
                Ajusta el orden y la visibilidad de los widgets autorizados para tu rol.
              </p>

              <div className="space-y-2 max-h-80 overflow-y-auto mb-6">
                {configWidgets.map((w, index) => (
                  <div
                    key={w.widget_id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      w.visible ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-900/30 border-gray-800 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleVisible(w.widget_id)}
                        className="text-brand-light hover:text-white"
                        title={w.visible ? 'Ocultar widget' : 'Mostrar widget'}
                      >
                        {w.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4 text-text-secondary" />}
                      </button>
                      <span className="text-sm font-medium">{w.title}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleMoveOrder(index, -1)}
                        disabled={index === 0}
                        className="p-1 text-text-secondary hover:text-white disabled:opacity-30"
                        title="Mover arriba"
                      >
                        <MoveUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveOrder(index, 1)}
                        disabled={index === configWidgets.length - 1}
                        className="p-1 text-text-secondary hover:text-white disabled:opacity-30"
                        title="Mover abajo"
                      >
                        <MoveDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfigModal(false)}
                  disabled={savingConfig}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                >
                  {savingConfig ? 'Guardando...' : 'Guardar Preferencias'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
