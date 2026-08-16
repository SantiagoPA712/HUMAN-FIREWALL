import React, { useState } from 'react';
import { ShieldCheck, Mail, Lock, UserPlus } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import axios from 'axios';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (password !== confirmPassword) {
      setIsLoading(false);
      return setError('Las contraseñas no coinciden. Intenta de nuevo.');
    }

    try {
      const res = await axios.post('http://localhost:3000/api/auth/register', {
        email,
        password
      });

      // El servidor de registro de Human Firewall autologuea firmando token
      localStorage.setItem('token', res.data.token);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err.response?.data?.msg || "Error de conexión al servidor de registro.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-deep text-text-primary flex flex-col items-center justify-center p-6 bg-gradient-to-b from-bg-deep to-brand-dark/20 relative overflow-hidden">

      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[100px] rounded-full pointer-events-none"></div>

      <div className="flex flex-col items-center mb-8 z-10">
        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 border border-brand-blue/30 shadow-[0_0_15px_rgba(37,99,235,0.2)]">
          <UserPlus className="w-8 h-8 text-brand-blue" />
        </div>
        <h1 className="text-3xl font-bold">Únete a Human Firewall</h1>
        <p className="text-text-secondary mt-2">Dile adiós a las vulnerabilidades humanas. Comienza tu entrenamiento.</p>
      </div>

      <Card className="w-full max-w-md z-10 border border-gray-800 bg-bg-deep/80 backdrop-blur-xl">
        <form onSubmit={handleRegister} className="flex flex-col gap-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg text-sm text-center animate-pulse">
              {error}
            </div>
          )}

          <Input
            icon={Mail}
            label="Correo Corporativo"
            type="email"
            placeholder="nuevo_usuario@empresa.com"
            className="bg-transparent"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Input
            icon={Lock}
            label="Contraseña"
            type="password"
            placeholder="••••••••"
            className="bg-transparent"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <Input
            icon={Lock}
            label="Confirmar Contraseña"
            type="password"
            placeholder="••••••••"
            className="bg-transparent"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          <Button type="submit" className="w-full mt-4 py-3 text-lg" disabled={isLoading}>
            {isLoading ? "Creando perfil e Inscribiendo..." : "Crear mi cuenta gratuita"}
          </Button>

          <div className="relative flex items-center py-4">
            <div className="flex-grow border-t border-gray-800"></div>
            <span className="flex-shrink-0 mx-4 text-text-secondary text-sm">¿Ya tienes cuenta?</span>
            <div className="flex-grow border-t border-gray-800"></div>
          </div>

          <Button type="button" variant="outline" className="w-full border-gray-700 text-gray-300 hover:bg-gray-800" onClick={() => window.location.href = '/login'}>
            Inicia sesión aquí
          </Button>

        </form>
      </Card>
    </div>
  );
}
