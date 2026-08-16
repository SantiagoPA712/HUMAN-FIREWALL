import React from 'react';
import { Globe, Award, TrendingUp, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg-deep text-text-primary flex flex-col items-center">
      
      {/* Header/Nav */}
      <header className="w-full flex justify-between items-center px-10 py-6 max-w-7xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-8 h-8 text-brand-blue" />
          <span className="text-xl font-bold">Human Firewall</span>
        </div>
        <div className="flex gap-4">
          <Button variant="outline" className="text-sm py-2" onClick={() => window.location.href = '/login'}>Iniciar Sesión</Button>
          <Button variant="secondary" className="text-sm py-2" onClick={() => window.location.href = '/register'}>Registrarse Gratis</Button>
        </div>
      </header>

      {/* Main Section */}
      <main className="flex-1 w-full max-w-6xl px-6 py-20 flex flex-col items-center text-center">
        
        <h1 className="text-5xl md:text-6xl font-bold mb-16 tracking-tight">
          ¿Por qué Human Firewall?
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full mb-24">
          <Card className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-brand-blue/10 flex items-center justify-center mb-6">
              <Globe className="w-8 h-8 text-brand-light" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Diseñado para LATAM</h3>
            <p className="text-text-secondary leading-relaxed">
              Contenido localizado, casos reales de la región y soporte en español.
            </p>
          </Card>

          <Card className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-brand-blue/10 flex items-center justify-center mb-6">
              <Award className="w-8 h-8 text-brand-light" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Gamificación Real</h3>
            <p className="text-text-secondary leading-relaxed">
              Desafíos, rankings, logros y recompensas que motivan el aprendizaje continuo.
            </p>
          </Card>

          <Card className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-brand-blue/10 flex items-center justify-center mb-6">
              <TrendingUp className="w-8 h-8 text-brand-light" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Reportes Accionables</h3>
            <p className="text-text-secondary leading-relaxed">
              Detecta vulnerabilidades humanas y genera planes de mejora automáticos.
            </p>
          </Card>
        </div>

      </main>
      
      {/* Footer CTA */}
      <section className="w-full bg-gradient-to-br from-brand-blue to-brand-dark py-24 flex flex-col items-center text-center px-6">
        <h2 className="text-4xl md:text-5xl font-bold mb-6 text-white">Protege tu empresa hoy</h2>
        <p className="text-xl opacity-90 mb-10 max-w-2xl text-white">
          Agenda una demo personalizada con nuestro equipo
        </p>
        <Button variant="secondary" className="px-8 py-4 text-lg" onClick={() => window.location.href = '/register'}>
          <ShieldCheck className="w-6 h-6 mr-2" />
          Comenzar Gratis Ahora
        </Button>
      </section>

    </div>
  );
}
