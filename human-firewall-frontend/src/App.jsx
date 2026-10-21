import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import PhishingGame from './pages/simulations/PhishingGame';
import RansomwareGame from './pages/simulations/RansomwareGame';
import AdminDashboard from './pages/AdminDashboard';
import ChallengesHub from './pages/ChallengesHub';
import WifiGame from './pages/simulations/WifiGame';
import PasswordGame from './pages/simulations/PasswordGame';
import SocialEngineeringGame from './pages/simulations/SocialEngineeringGame';
import SimulationPlayer from './pages/simulations/SimulationPlayer';
import PointsHistory from './pages/PointsHistory';
import RewardsGallery from './pages/RewardsGallery';
import MyLevel from './pages/MyLevel';
import Performance from './pages/Performance';
import ReportsPage from './pages/ReportsPage';
import SecurityPanel from './pages/SecurityPanel';
import ScheduledReportsPage from './pages/ScheduledReportsPage';
import OrganizationalPage from './pages/OrganizationalPage';
import NotificationsPage from './pages/NotificationsPage';
import PreferencesPage from './pages/PreferencesPage';
import AuditLogsPage from './pages/AuditLogsPage';
import AcceptInvitationPage from './pages/AcceptInvitationPage';
import InvitationsPage from './pages/InvitationsPage';
import ProfilePage from './pages/ProfilePage';
import { PuntosProvider } from './context/PuntosContext';
import { ThemeProvider } from './context/ThemeContext';
import { IdiomaProvider } from './context/IdiomaContext';
import { TextSizeProvider } from './context/TextSizeContext';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        {/* El idioma envuelve a toda la aplicacion para que valga igual en
            cualquier pantalla: criterio de aceptacion 7, el idioma elegido se
            mantiene al pasar de un modulo a otro. */}
        <IdiomaProvider>
        {/* Tamano de texto: envuelve a todas las rutas para que la escala
            elegida se mantenga al pasar de un modulo a otro. */}
        <TextSizeProvider>
        <PuntosProvider>
          <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Completar el registro desde una invitacion. Publica: el token del
            correo es la credencial, y lo valida el backend. */}
        <Route path="/invitacion" element={<AcceptInvitationPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/challenges" element={<ChallengesHub />} />
        <Route path="/points" element={<PointsHistory />} />
        <Route path="/rewards" element={<RewardsGallery />} />
        <Route path="/level" element={<MyLevel />} />
        <Route path="/performance" element={<Performance />} />

        {/* Perfil propio: cada usuario ve y edita solo el suyo. El backend
            toma el id del token, no de la URL. */}
        <Route path="/perfil" element={<ProfilePage />} />

        {/* Centro de notificaciones: es de cada usuario, no tiene restriccion
            de rol. El bloque de cursos criticos, dentro de la pantalla, solo
            lo ve RH porque el backend responde 403 al resto. */}
        <Route path="/notifications" element={<NotificationsPage />} />

        {/* Preferencias de la cuenta: idioma de la plataforma. Es de cada
            usuario sobre si mismo, asi que no lleva restriccion de rol; el
            backend saca el id del token y nadie puede tocar las de otro. */}
        <Route path="/preferencias" element={<PreferencesPage />} />

        {/* Reportes de RH: el backend rechaza con 403 a quien no sea rh o admin */}
        <Route path="/reports" element={<ReportsPage />} />

        {/* Panel de seguridad: el backend rechaza con 403 a quien no sea security o admin */}
        <Route path="/security" element={<SecurityPanel />} />

        {/* Reportes automaticos. La configuracion es solo de admin y el
            historico lo ven los roles suscritos: lo decide el backend, la
            pantalla solo evita mostrar lo que no va a poder cargar.

            Va con prefijo /reports/ y no en una ruta suelta para que las tres
            pantallas de reportes se lean como lo que son: la misma familia. */}
        <Route path="/reports/programados" element={<ScheduledReportsPage />} />

        {/* Resultados organizacionales: el backend rechaza con 403 a quien no
            sea manager o admin */}
        <Route path="/reports/organizacional" element={<OrganizationalPage />} />

        {/* Rutas Simulaciones */}
        <Route path="/simulation/phishing" element={<PhishingGame />} />
        <Route path="/simulation/ransomware" element={<RansomwareGame />} />
        <Route path="/simulation/password" element={<PasswordGame />} />
        <Route path="/simulation/wifi" element={<WifiGame />} />
        <Route path="/simulation/social" element={<SocialEngineeringGame />} />

        {/* Simulaciones cargadas en la base, no escritas a mano en React.
            El id es el de la tabla simulations. Va con prefijo /play para no
            chocar con las rutas fijas de arriba. */}
        <Route path="/simulation/play/:id" element={<SimulationPlayer />} />
        
        {/* Rutas Admin */}
        <Route path="/admin" element={<AdminDashboard />} />

        {/* Logs de auditoria (data.logs): el backend rechaza con 403 a quien
            no sea admin. Cuelga de /admin porque es una herramienta de
            administracion, no una pantalla de negocio. */}
        <Route path="/admin/logs" element={<AuditLogsPage />} />

        {/* Invitaciones de usuarios: el backend rechaza con 403 a quien no
            sea admin. Mismo lugar que el registro de acciones. */}
        <Route path="/admin/invitaciones" element={<InvitationsPage />} />

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      </PuntosProvider>
      </TextSizeProvider>
      </IdiomaProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
