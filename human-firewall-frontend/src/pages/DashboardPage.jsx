import React, { useEffect, useState } from 'react';
import { ShieldCheck, BookOpen, Target, Trophy, LogOut, Award, History, Shield, TrendingUp, BarChart3, ShieldAlert, CalendarClock, Building2, Bell, ScrollText, User, Palette, MailPlus, Type, Languages } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PointsWidget } from '../components/PointsWidget';
import { LevelBadge } from '../components/LevelBadge';
import { ThemeToggle } from '../components/ThemeToggle';
import { ThemeSelector } from '../components/ThemeSelector';
import { TextSizeSelector } from '../components/TextSizeSelector';
import { UserProfileModal } from '../components/UserProfileModal';
import { usePuntos } from '../context/PuntosContext';
import { api, getUsuarioActual } from '../lib/api';
import { useIdioma } from '../context/useIdioma';

export default function DashboardPage() {
  const [userName, setUserName] = useState("Admin");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const { recompensas, nivel } = usePuntos();
  const { t } = useIdioma();

  // El enlace a reportes solo tiene sentido para quien puede abrirlos: el
  // backend responde 403 al resto, y un menu que lleva a un error es peor que
  // no tener el menu.
  const usuario = getUsuarioActual();

  // El efecto queda como lo dejo el perfil editable: se saluda con el nombre
  // registrado si lo hay, y si no con "Empleado #3". Lo unico que cambia es
  // que ese respaldo sale del diccionario y que `t` entra en las
  // dependencias, para que se traduzca al cambiar de idioma. El nombre propio
  // no se traduce: por eso se vuelve a pedir y se pisa igual.
  useEffect(() => {
    if (usuario?.id) {
      setUserName(usuario.role === 'admin' ? 'Admin' : t('panel.empleado', { id: usuario.id }));
      // Si la persona ya registro su nombre en el perfil, se saluda con el.
      api.get('/api/users/me')
        .then(({ data }) => { if (data.full_name) setUserName(data.full_name); })
        .catch(() => {});
    }
  }, [usuario?.id, usuario?.role, t]);

  const puedeVerReportes = usuario?.role === 'rh' || usuario?.role === 'admin';
  const puedeVerSeguridad = usuario?.role === 'security' || usuario?.role === 'admin';

  // Reportes automaticos: los ve todo destinatario posible (la configuracion,
  // dentro de la pantalla, sigue siendo solo de admin).
  const puedeVerProgramados = ['rh', 'security', 'manager', 'admin'].includes(usuario?.role);

  // Resultados organizacionales: gerencia y administracion, igual que el
  // endpoint.
  const puedeVerOrganizacional = usuario?.role === 'manager' || usuario?.role === 'admin';

  // Registro de acciones (data.logs): solo admin, igual que GET /api/logs.
  const puedeVerLogs = usuario?.role === 'admin';
  
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
          {/* Este enlace decia "Mi Desempeño" y apuntaba al propio dashboard.
              Ahora "Mi Desempeño" es una seccion real, asi que este pasa a
              llamarse Panel para que no haya dos cosas con el mismo nombre. */}
          <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 rounded-lg bg-brand-blue/10 text-brand-light font-medium">
            <Trophy className="w-5 h-5" />
            {t('nav.panel')}
          </a>
          <a href="/perfil" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <User className="w-5 h-5" />
            {t('nav.mi_perfil')}
          </a>
          <a href="/performance" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <TrendingUp className="w-5 h-5" />
            {t('nav.mi_desempeno')}
          </a>
          <a href="/level" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <Shield className="w-5 h-5" />
            {t('nav.mi_nivel')}
          </a>
          <a href="/points" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <History className="w-5 h-5" />
            {t('nav.historial_puntos')}
          </a>
          {/* El centro de notificaciones es de todos: cada usuario ve solo lo suyo. */}
          <a href="/notifications" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <Bell className="w-5 h-5" />
            {t('nav.notificaciones')}
          </a>
          {/* Preferencias de la cuenta: el idioma de la plataforma. Es de
              todos, cada uno configura la suya y el backend saca el id del
              token, asi que nadie toca la de otro. */}
          <a href="/preferencias" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
            <Languages className="w-5 h-5" />
            {t('nav.preferencias')}
          </a>
          <a href="/challenges" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
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
          {puedeVerSeguridad && (
            <a href="/security" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
              <ShieldAlert className="w-5 h-5" />
              {t('nav.seguridad')}
            </a>
          )}
          {puedeVerReportes && (
            <a href="/reports" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
              <BarChart3 className="w-5 h-5" />
              {t('nav.reportes')}
            </a>
          )}
          {puedeVerProgramados && (
            <a href="/reports/programados" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
              <CalendarClock className="w-5 h-5" />
              {t('nav.reportes_automaticos')}
            </a>
          )}
          {puedeVerOrganizacional && (
            <a href="/reports/organizacional" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
              <Building2 className="w-5 h-5" />
              {t('nav.organizacional')}
            </a>
          )}
          {/* Invitaciones de usuarios: solo admin, igual que /api/invitations. */}
          {puedeVerLogs && (
            <a href="/admin/invitaciones" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
              <MailPlus className="w-5 h-5" />
              {t('nav.invitaciones')}
            </a>
          )}
          {puedeVerLogs && (
            <a href="/admin/logs" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-text-secondary hover:text-white transition-colors">
              <ScrollText className="w-5 h-5" />
              {t('nav.registro_acciones')}
            </a>
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          {/* Configuración de Apariencia y Tema */}
          <div className="rounded-xl border border-border-color bg-bg-card/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-brand-blue" />
                {t('nav.tema')}
              </span>
            </div>
            <ThemeSelector variant="segmented" className="w-full justify-center" />
            <span className="mt-3 mb-2 text-xs font-semibold text-text-secondary flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-brand-blue" />
              {t('texto.titulo')}
            </span>
            <TextSizeSelector variant="segmented" className="w-full" />
            <button
              type="button"
              onClick={() => setIsProfileOpen(true)}
              className="mt-2.5 flex items-center justify-center gap-1.5 w-full text-xs text-brand-light hover:underline font-medium cursor-pointer"
            >
              <User className="w-3.5 h-3.5" />
              {t('nav.perfil_configuracion')}
            </button>
          </div>

          <Button variant="outline" className="w-full justify-start text-text-secondary border-border-color hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/50" onClick={handleLogout}>
            <LogOut className="w-5 h-5 mr-2" />
            {t('nav.cerrar_sesion')}
          </Button>
        </div>
      </aside>

      {/* Contenido Principal */}
      <main className="flex-1 p-10 overflow-y-auto">
        <header className="mb-10 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('panel.bienvenido', { nombre: userName })}</h1>
            <p className="text-text-secondary mt-1">{t('panel.resumen')}</p>
          </div>
          <div className="flex items-center flex-wrap gap-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setIsProfileOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-border-color bg-bg-card/40 px-3 py-2 text-text-secondary hover:text-text-primary hover:border-brand-blue/60 transition-colors cursor-pointer"
              title={t('nav.perfil_tema_titulo')}
            >
              <User className="h-4 w-4 text-brand-blue" />
              <span className="text-sm font-medium">{t('nav.perfil_tema')}</span>
            </button>
            <PointsWidget compacto />
            {/* El nivel salia fijo en "Cinturón Blanco" / 1 para todo el mundo
                porque users.level nunca se calculaba (deuda tecnica 9).
                Ahora viene derivado de points_ledger + levels_config. */}
            <a href="/level" title={t('panel.ver_mi_nivel')}>
              <LevelBadge nivel={nivel} compacto />
            </a>
          </div>
        </header>

        {/* Widgets Gamificación (Epic 6 & 7). Columnas por ancho minimo y no
            por breakpoint: ver grid-ajustable en index.css. */}
        <div className="grid grid-ajustable [--ancho-columna:15rem] gap-6 mb-10">
          <Card className="p-6">
            <PointsWidget />
          </Card>
          
          {/* Reemplaza a "Simulaciones Fallidas", que mostraba un 0 fijo
              escrito a mano y no se calculaba de ningun lado. */}
          <Card className="p-6">
            <LevelBadge nivel={nivel} />
            <a href="/level" className="mt-3 block text-sm text-brand-light hover:underline">
              {t('panel.ver_mi_nivel')}
            </a>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-brand-dark/40 to-brand-blue/20">
            <h3 className="text-lg font-bold mb-2 text-brand-light">{t('panel.insignias_ganadas')}</h3>
            {recompensas.length === 0 ? (
              <span className="text-sm text-text-secondary">{t('panel.sin_insignias')}</span>
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
              {t('panel.ver_mis_logros')}
            </a>
          </Card>
        </div>

        {/* Cursos Pendientes (Epic 3) */}
        <h2 className="text-2xl font-bold mb-6">{t('panel.tareas_pendientes')}</h2>
        <div className="grid grid-ajustable [--ancho-columna:20rem] gap-6">
          <Card className="p-6 flex flex-col justify-between border-l-4 border-l-brand-blue">
            <div>
              <div className="flex items-center gap-2 text-brand-light mb-2">
                <BookOpen className="w-5 h-5" />
                <span className="text-sm font-semibold uppercase tracking-wider">{t('panel.modulo_curso')}</span>
              </div>
              <h3 className="text-xl font-bold mb-2">{t('panel.curso_phishing')}</h3>
              <p className="text-sm text-text-secondary line-clamp-2 mb-6">{t('panel.curso_phishing_desc')}</p>
            </div>
            <Button className="w-full" onClick={() => window.location.href = '/simulation/phishing'}>{t('panel.comenzar_modulo')}</Button>
          </Card>

          <Card className="p-6 flex flex-col justify-between border-l-4 border-l-purple-500">
            <div>
              <div className="flex items-center gap-2 text-purple-400 mb-2">
                <Target className="w-5 h-5" />
                <span className="text-sm font-semibold uppercase tracking-wider">{t('panel.simulacion_interactiva')}</span>
              </div>
              <h3 className="text-xl font-bold mb-2">{t('panel.simulacion_ransomware')}</h3>
              <p className="text-sm text-text-secondary line-clamp-2 mb-6">{t('panel.simulacion_ransomware_desc')}</p>
            </div>
            <Button className="w-full bg-purple-600 hover:bg-purple-500 hover:shadow-purple-500/30" onClick={() => window.location.href = '/simulation/ransomware'}>{t('panel.lanzar_simulacion')}</Button>
          </Card>
        </div>

      </main>

      {/* Modal de Configuración y Perfil del Usuario */}
      <UserProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        userName={userName}
      />
    </div>
  );
}
