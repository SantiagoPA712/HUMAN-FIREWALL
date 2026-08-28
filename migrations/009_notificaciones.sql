-- =====================================================================
-- 009_notificaciones.sql
-- Arquitectura basada en eventos: bandeja de notificaciones.
--
-- El servicio de notificaciones no es llamado por nadie. Se suscribe a
-- user.registered, level_up y reward_granted, y escribe aca. Por eso puede
-- existir sin que ningun controlador sepa de el: agregar un aviso nuevo no
-- toca el codigo que provoco el hecho.
--
-- Depende de: schema.sql (users)
-- =====================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Evento que la origino. Permite responder "por que me llego esto".
    event_name  VARCHAR(50) NOT NULL,

    title       VARCHAR(150) NOT NULL,
    body        TEXT NOT NULL,
    payload     JSONB,

    -- Clave anti-duplicado.
    --
    -- El worker del outbox REINTENTA un evento cuyo handler fallo. Sin esta
    -- restriccion, un fallo despues de haber mandado el correo haria que el
    -- reintento lo mandara otra vez: el usuario recibe tres correos por el
    -- mismo nivel. Con la clave unica, el segundo intento no inserta nada y
    -- el handler sabe que no debe volver a enviar.
    dedupe_key  VARCHAR(200) NOT NULL UNIQUE,

    -- 'sent'    -> el correo salio
    -- 'failed'  -> se intento y fallo (no se reintenta: ver notifications.service)
    -- 'skipped' -> no hay SMTP configurado, queda solo como aviso en la app
    email_status VARCHAR(20) NOT NULL DEFAULT 'skipped'
                 CHECK (email_status IN ('sent','failed','skipped')),
    email_error  TEXT,

    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La bandeja se consulta siempre por usuario y en orden cronologico inverso.
CREATE INDEX IF NOT EXISTS idx_notifications_usuario
    ON notifications (user_id, created_at DESC);

-- Indice parcial para el contador de "no leidas" del encabezado.
CREATE INDEX IF NOT EXISTS idx_notifications_no_leidas
    ON notifications (user_id) WHERE read_at IS NULL;
