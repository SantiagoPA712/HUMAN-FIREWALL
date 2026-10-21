import React from 'react';
import { Globe, Award, TrendingUp, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ThemeToggle } from '../components/ThemeToggle';
import { useIdioma } from '../context/useIdioma';

export default function LandingPage() {
  const { t } = useIdioma();

  return (
    <div className="min-h-screen bg-bg-deep text-text-primary flex flex-col items-center">
      
      {/* Header/Nav */}
      <header className="w-full flex justify-between items-center px-10 py-6 max-w-7xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-8 h-8 text-brand-blue" />
          <span className="text-xl font-bold">Human Firewall</span>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Button variant="outline" className="text-sm py-2" onClick={() => window.location.href = '/login'}>{t('inicio.iniciar_sesion')}</Button>
          <Button variant="secondary" className="text-sm py-2" onClick={() => window.location.href = '/register'}>{t('inicio.registrarse_gratis')}</Button>
        </div>
      </header>

      {/* Main Section */}
      <main className="flex-1 w-full max-w-6xl px-6 py-20 flex flex-col items-center text-center">
        
        <h1 className="text-5xl md:text-6xl font-bold mb-16 tracking-tight">
          {t('inicio.por_que')}
        </h1>

        <div className="grid grid-ajustable [--ancho-columna:16rem] gap-8 w-full mb-24">
          <Card className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-brand-blue/10 flex items-center justify-center mb-6">
              <Globe className="w-8 h-8 text-brand-light" />
            </div>
            <h3 className="text-2xl font-bold mb-4">{t('inicio.latam_titulo')}</h3>
            <p className="text-text-secondary leading-relaxed">
              {t('inicio.latam_desc')}
            </p>
          </Card>

          <Card className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-brand-blue/10 flex items-center justify-center mb-6">
              <Award className="w-8 h-8 text-brand-light" />
            </div>
            <h3 className="text-2xl font-bold mb-4">{t('inicio.gamificacion_titulo')}</h3>
            <p className="text-text-secondary leading-relaxed">
              {t('inicio.gamificacion_desc')}
            </p>
          </Card>

          <Card className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-brand-blue/10 flex items-center justify-center mb-6">
              <TrendingUp className="w-8 h-8 text-brand-light" />
            </div>
            <h3 className="text-2xl font-bold mb-4">{t('inicio.reportes_titulo')}</h3>
            <p className="text-text-secondary leading-relaxed">
              {t('inicio.reportes_desc')}
            </p>
          </Card>
        </div>

      </main>
      
      {/* Footer CTA */}
      <section className="w-full bg-gradient-to-br from-brand-blue to-brand-dark py-24 flex flex-col items-center text-center px-6">
        <h2 className="text-4xl md:text-5xl font-bold mb-6 text-white">{t('inicio.protege_titulo')}</h2>
        <p className="text-xl opacity-90 mb-10 max-w-2xl text-white">
          {t('inicio.protege_desc')}
        </p>
        <Button variant="secondary" className="px-8 py-4 text-lg" onClick={() => window.location.href = '/register'}>
          <ShieldCheck className="w-6 h-6 mr-2" />
          {t('inicio.comenzar_gratis')}
        </Button>
      </section>

    </div>
  );
}
