import React, { useEffect } from 'react';
import { ArrowLeft, MailPlus, ShieldAlert } from 'lucide-react';
import { Card } from '../components/ui/Card';
import InvitationsPanel from '../components/InvitationsPanel';
import { getUsuarioActual } from '../lib/api';
import { useIdioma } from '../context/useIdioma';

/**
 * Invitaciones de usuarios (HU de invitaciones), como pagina propia.
 *
 * El panel vivia solo como pestana de /admin, y a /admin no lleva ningun
 * enlace del menu lateral: la funcionalidad existia pero nadie la encontraba.
 * Ahora cuelga de /admin/invitaciones, igual que el registro de acciones, y
 * aparece en el menu del admin.
 *
 * La pantalla solo evita mostrar lo que no va a poder cargar: quien decide es
 * el backend, que responde 403 a cualquiera que no sea admin.
 */
export default function InvitationsPage() {
    const { t } = useIdioma();
    const usuario = getUsuarioActual();
    const autorizado = usuario?.role === 'admin';

    useEffect(() => {
        if (!usuario) window.location.href = '/login';
    }, [usuario]);

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-6xl">
                <a href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-text-secondary hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> {t('invitaciones.volver_al_panel')}
                </a>
                <header className="mb-8">
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <MailPlus className="h-8 w-8 text-brand-blue" />
                        {t('invitaciones.titulo')}
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        {t('invitaciones.subtitulo')}
                    </p>
                </header>

                {autorizado ? (
                    <InvitationsPanel />
                ) : (
                    <Card className="p-8 text-center hover:scale-100">
                        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-red-400" />
                        <p className="font-semibold">{t('invitaciones.solo_admin')}</p>
                    </Card>
                )}
            </div>
        </div>
    );
}
