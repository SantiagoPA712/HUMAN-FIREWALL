import React, { useState } from 'react';
import { ShieldCheck, Mail, Lock } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import axios from 'axios';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      // Intentar conectarse al server backend en el mismo equipo (Epic 1)
      const res = await axios.post('http://localhost:3000/api/auth/login', {
        email,
        password
      });
      // Guardar token y redirigir
      localStorage.setItem('token', res.data.token);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err.response?.data?.msg || "Error de conexión al servidor.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-deep text-text-primary flex flex-col items-center justify-center p-6 bg-gradient-to-b from-bg-deep to-brand-dark/20">
      <div className="flex flex-col items-center mb-8">
        <ShieldCheck className="w-12 h-12 text-brand-blue mb-4" />
        <h1 className="text-3xl font-bold">Inicia Sesión en Human Firewall</h1>
        <p className="text-text-secondary mt-2">Plataforma de concientización en ciberseguridad</p>
      </div>

      <Card className="w-full max-w-md">
        <form onSubmit={handleLogin} className="flex flex-col gap-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg text-sm text-center">
              {error}
            </div>
          )}
          
          <Input 
            icon={Mail}
            label="Correo Electrónico" 
            type="email" 
            placeholder="tu@empresa.com" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Input 
            icon={Lock}
            label="Contraseña" 
            type="password" 
            placeholder="••••••••" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <div className="flex justify-end">
            <a href="/forgot-password" className="text-sm text-brand-light hover:underline">¿Olvidaste tu contraseña?</a>
          </div>

          <Button type="submit" className="w-full mt-2">
            {isLoading ? "Iniciando..." : "Ingresar a mi Dashboard"}
          </Button>

          <div className="relative flex items-center py-4">
            <div className="flex-grow border-t border-gray-700"></div>
            <span className="flex-shrink-0 mx-4 text-text-secondary text-sm">¿No tienes cuenta?</span>
            <div className="flex-grow border-t border-gray-700"></div>
          </div>

          <Button type="button" variant="outline" className="w-full text-white border-brand-blue/50 hover:bg-brand-blue/10" onClick={() => window.location.href = '/register'}>
            Crear cuenta B2B gratuita
          </Button>
        </form>
      </Card>
    </div>
  );
}
