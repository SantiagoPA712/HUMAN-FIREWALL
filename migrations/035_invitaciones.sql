-- =====================================================================
-- 035_invitaciones.sql
-- HU: "Yo como sistema quiero enviar invitaciones por correo a nuevos
-- usuarios (empleados, instructores, RH) con un enlace seguro para completar
-- su registro, para facilitar el proceso de onboarding sin que el
-- administrador deba compartir credenciales manualmente."
--
-- Que agrega y por que:
--
--   users.full_name            -> dato de perfil que el invitado completa (CA 2)
--   user_invitations           -> la invitacion: correo, rol, token (hash), vencimiento
--   user_invitation_events     -> historial inmutable de cada cambio de estado (CT 4)
--   tipo de correo + plantillas -> el correo de invitacion sale por la cola de la 034
--
-- Depende de: schema.sql (users), 034_notificaciones_por_correo.sql
--             (email_notification_types, email_templates)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfil
-- ---------------------------------------------------------------------
-- La tabla users no tenia ningun dato de la persona mas alla del correo. El
-- criterio de aceptacion 2 pide "completar los datos requeridos de mi perfil":
-- el nombre es el minimo que hace falta para que RH sepa quien es quien.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS full_name VARCHAR(150);

-- ---------------------------------------------------------------------
-- Invitaciones
-- ---------------------------------------------------------------------
-- Estados:
--   pending   -> enviada, esperando que la acepten
--   accepted  -> se uso para crear la cuenta; el token ya no sirve
--   expired   -> vencio sin usarse. Se materializa al detectarlo (listar,
--                validar, invitar), con expired_at = expires_at
--   cancelled -> la cancelo un administrador
--
-- Del token solo se guarda el SHA-256 (criterio tecnico 1). Quien lea esta
-- tabla no puede armar un enlace valido: el token en claro solo viaja en el
-- correo. El hash es UNIQUE, asi que la busqueda por token es por indice.
CREATE TABLE IF NOT EXISTS user_invitations (
    id                  BIGSERIAL PRIMARY KEY,

    -- Siempre en minusculas: "Ana@HF.com" y "ana@hf.com" son la misma persona,
    -- y la regla de duplicados (CT 3) no puede depender de como se tipeo.
    email               VARCHAR(255) NOT NULL CHECK (email = lower(email)),

    -- Solo los roles que nombra la HU. Una invitacion no puede crear un admin:
    -- eso sigue siendo un alta manual y auditada.
    role                VARCHAR(50) NOT NULL CHECK (role IN ('employee', 'instructor', 'rh')),

    -- Idioma del correo de invitacion. NULL = el de la plataforma.
    language            VARCHAR(5) CHECK (language IS NULL OR language IN ('es', 'en')),

    token_hash          CHAR(64) NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,

    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),

    invited_by          INT REFERENCES users(id) ON DELETE SET NULL,
    -- Cuantas veces se mando: 1 al crear, +1 por cada reenvio. Tambien
    -- identifica cada correo en la cola (un reenvio es un correo nuevo).
    send_count          INT NOT NULL DEFAULT 1 CHECK (send_count > 0),

    -- El invitado pidio un enlace nuevo desde uno vencido (CA 3). Se limpia
    -- al reenviar.
    resend_requested_at TIMESTAMPTZ,

    accepted_user_id    INT REFERENCES users(id) ON DELETE SET NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at         TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    expired_at          TIMESTAMPTZ
);

-- Criterio tecnico 3: una sola invitacion pendiente por correo. El servicio
-- lo verifica antes para responder 409 con el estado actual; el indice es la
-- red para dos pedidos simultaneos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_invitations_pendiente
    ON user_invitations (email) WHERE status = 'pending';

-- El panel lista por estado y en orden cronologico inverso.
CREATE INDEX IF NOT EXISTS idx_user_invitations_estado
    ON user_invitations (status, created_at DESC);

-- Para materializar vencidas sin recorrer toda la tabla.
CREATE INDEX IF NOT EXISTS idx_user_invitations_vencimiento
    ON user_invitations (expires_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- Historial de cada invitacion (criterio tecnico 4)
-- ---------------------------------------------------------------------
-- "Registrar el ID del administrador que la genero, el correo invitado, el
-- rol asignado y el timestamp de cada cambio de estado". Una fila por cambio,
-- con esos datos copiados: si mas tarde se borra el admin, el historial sigue
-- diciendo quien la genero.
--
-- actor_user_id es quien HIZO el cambio: el admin al crear, reenviar o
-- cancelar; la cuenta nueva al aceptar; NULL cuando es el sistema (vencida) o
-- el invitado sin cuenta (pedido de reenvio).
CREATE TABLE IF NOT EXISTS user_invitation_events (
    id            BIGSERIAL PRIMARY KEY,
    invitation_id BIGINT NOT NULL REFERENCES user_invitations(id),
    action        VARCHAR(20) NOT NULL
                  CHECK (action IN ('created', 'resent', 'cancelled', 'accepted', 'expired', 'resend_requested')),
    actor_user_id INT,
    invited_by    INT,
    email         VARCHAR(255) NOT NULL,
    role          VARCHAR(50) NOT NULL,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_invitation_events_invitacion
    ON user_invitation_events (invitation_id, occurred_at);

-- Solo INSERT: un historial que se puede reescribir no es trazabilidad.
CREATE OR REPLACE FUNCTION user_invitation_events_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'user_invitation_events es de solo insercion (%)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_invitation_events_inmutable ON user_invitation_events;
CREATE TRIGGER trg_user_invitation_events_inmutable
    BEFORE UPDATE OR DELETE ON user_invitation_events
    FOR EACH ROW EXECUTE FUNCTION user_invitation_events_inmutable();

-- ---------------------------------------------------------------------
-- Correo de invitacion
-- ---------------------------------------------------------------------
-- Algunos tipos de correo no son para usuarios con cuenta: la invitacion le
-- llega a alguien que todavia no existe en users. No tiene sentido listarlo en
-- las preferencias de nadie.
ALTER TABLE email_notification_types
    ADD COLUMN IF NOT EXISTS user_configurable BOOLEAN NOT NULL DEFAULT true;

-- Critico: sin este correo no hay alta posible, y el invitado no tiene cuenta
-- desde la cual desactivarlo.
INSERT INTO email_notification_types (code, is_critical, description, user_configurable) VALUES
    ('user_invitation', true, 'Invitacion para crear una cuenta', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO email_templates (notification_type, language, version, subject, body_html, body_text) VALUES

('user_invitation', 'es', 1,
 'Te invitaron a Human Firewall',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#1d4ed8">Te damos la bienvenida a Human Firewall</h2>
<p>{{invitador}} te invito a sumarte a la plataforma de concientizacion en ciberseguridad con el rol <strong>{{rol}}</strong>.</p>
<p>Para activar tu cuenta, defini tu contrasena y completa tu perfil:</p>
<p><a href="{{enlace}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Completar mi registro</a></p>
<p style="font-size:13px">El enlace vence el <strong>{{fechaLimite}}</strong> y sirve una sola vez.</p>
<p style="font-size:12px;color:#6b7280">Si no esperabas esta invitacion, podes ignorar este correo: sin completar el registro no se crea ninguna cuenta.</p>
</div>$h$,
 $t${{invitador}} te invito a Human Firewall con el rol {{rol}}.
Completa tu registro aca: {{enlace}}
El enlace vence el {{fechaLimite}} y sirve una sola vez.
Si no esperabas esta invitacion, ignora este correo.$t$),

('user_invitation', 'en', 1,
 'You are invited to Human Firewall',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#1d4ed8">Welcome to Human Firewall</h2>
<p>{{invitador}} invited you to join the cybersecurity awareness platform with the role <strong>{{rol}}</strong>.</p>
<p>To activate your account, set your password and complete your profile:</p>
<p><a href="{{enlace}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Complete my registration</a></p>
<p style="font-size:13px">The link expires on <strong>{{fechaLimite}}</strong> and can be used only once.</p>
<p style="font-size:12px;color:#6b7280">If you were not expecting this invitation, you can ignore this email: no account is created unless you complete the registration.</p>
</div>$h$,
 $t${{invitador}} invited you to Human Firewall with the role {{rol}}.
Complete your registration here: {{enlace}}
The link expires on {{fechaLimite}} and can be used only once.
If you were not expecting this invitation, ignore this email.$t$)

ON CONFLICT (notification_type, language, version) DO NOTHING;
