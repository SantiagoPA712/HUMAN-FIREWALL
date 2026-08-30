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
import { PuntosProvider } from './context/PuntosContext';

function App() {
  return (
    <BrowserRouter>
      <PuntosProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/challenges" element={<ChallengesHub />} />
        <Route path="/points" element={<PointsHistory />} />
        <Route path="/rewards" element={<RewardsGallery />} />
        <Route path="/level" element={<MyLevel />} />
        <Route path="/performance" element={<Performance />} />

        {/* Reportes de RH: el backend rechaza con 403 a quien no sea rh o admin */}
        <Route path="/reports" element={<ReportsPage />} />
        
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

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      </PuntosProvider>
    </BrowserRouter>
  );
}

export default App;
