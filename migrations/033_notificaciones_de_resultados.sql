-- =====================================================================
-- 033_notificaciones_de_resultados.sql
-- HU: "Yo como sistema quiero notificar automaticamente los resultados
-- relevantes (evaluacion aprobada/reprobada, simulacion completada, curso
-- finalizado) tanto al usuario como a RH cuando corresponda."
--
-- Tres cosas que la tabla notifications (migracion 009) no puede sostener:
--
--   1. Canales por destinatario. Hoy el correo se manda si hay SMTP y punto;
--      el criterio tecnico 3 pide que cada persona elija sus canales.
--   2. Estado de lectura POR CANAL. notifications.read_at es uno solo, y el
--      criterio 3 dice que el estado de lectura se gestiona "de forma
--      independiente por canal".
--   3. Estado de entrega auditable (generada/entregada/fallida/leida) con su
--      timestamp, que pide el criterio tecnico 5.
--
-- Por eso notifications sigue siendo el AVISO (que se dijo, a quien) y estas
-- tablas nuevas son la ENTREGA (por donde salio, como termino). Separarlo
-- evita tocar una tabla de la que dependen los avisos de nivel, recompensa y
-- reportes automaticos.
--
-- Depende de: 009_notificaciones.sql (notifications), schema.sql (users, courses)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cursos criticos
-- ---------------------------------------------------------------------
-- Criterio de aceptacion 2: RH debe poder configurar que cursos considera
-- criticos para recibir alertas cuando alguien de su equipo los complete o
-- los repruebe.
--
-- La marca vive en el curso y no en una lista por cada RH porque el criterio
-- tecnico 2 la consulta asi: "si el curso esta marcado como critico". Es una
-- propiedad del curso (este contenido es sensible para la organizacion), no
-- una preferencia personal; quien la administra es RH desde el panel.
--
-- Arranca en false para todos: marcar cursos por nuestra cuenta seria decidir
-- por la organizacion cual de sus capacitaciones es sensible.
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false;

-- La consulta que corre en cada resultado es "este curso es critico?", y con
-- pocos cursos marcados el indice parcial es mucho mas chico que la tabla.
CREATE INDEX IF NOT EXISTS idx_courses_criticos
    ON courses (id) WHERE is_critical = true;

-- ---------------------------------------------------------------------
-- Canales por destinatario
-- ---------------------------------------------------------------------
-- Criterio tecnico 3: "debo entregar la notificacion por los canales
-- configurados por cada destinatario".
--
-- Sin fila para un usuario, el canal se considera HABILITADO. Es lo contrario
-- de sembrar una fila por persona y por canal en el alta: un padron de mil
-- empleados serian dos mil filas para expresar "todo por defecto". La
-- ausencia ya dice eso, y solo se escribe cuando alguien cambia algo.
CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel    VARCHAR(20) NOT NULL CHECK (channel IN ('in_app', 'email')),
    enabled    BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, channel)
);

-- ---------------------------------------------------------------------
-- Entregas
-- ---------------------------------------------------------------------
-- Criterio tecnico 5: "debo registrar su estado (generada, entregada,
-- fallida, leida) con el timestamp correspondiente, para soporte y
-- auditoria".
--
-- Una fila por (aviso, canal). Los cuatro estados no son excluyentes en el
-- tiempo -- un aviso se genera, se entrega y despues se lee -- asi que cada
-- uno tiene su propia columna de fecha ademas del estado actual. Con un solo
-- campo `updated_at` se perderia cuanto tardo en entregarse o cuanto paso
-- hasta que lo leyeron, que es justo lo que soporte necesita.
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id              BIGSERIAL PRIMARY KEY,

    notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,

    channel         VARCHAR(20) NOT NULL CHECK (channel IN ('in_app', 'email')),

    status          VARCHAR(20) NOT NULL DEFAULT 'generada'
                    CHECK (status IN ('generada', 'entregada', 'fallida', 'leida')),

    error           TEXT,

    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,

    -- Criterio tecnico 4: el mismo evento reprocesado no puede generar una
    -- segunda entrega. El aviso ya esta deduplicado por notifications.dedupe_key;
    -- esta restriccion cierra la otra mitad, la del canal.
    UNIQUE (notification_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_aviso
    ON notification_deliveries (notification_id);

-- Para el panel de soporte: que entregas fallaron y cuando.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_fallidas
    ON notification_deliveries (failed_at DESC) WHERE status = 'fallida';
