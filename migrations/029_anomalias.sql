-- =====================================================================
-- 029_anomalias.sql
-- HU: deteccion de patrones anomalos y abuso del sistema de puntos.
--
-- Tres tablas:
--   anomaly_rules          -> que se considera anomalo (configurable)
--   anomaly_events         -> lo detectado (inmutable salvo su status)
--   anomaly_status_history -> quien cambio el estado, cuando y por que
--
-- Depende de: 001_points_ledger.sql (points_ledger), schema.sql (users)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------
-- El umbral vive en la base, no en el codigo: el criterio de aceptacion 1
-- habla de "el umbral configurado", y el area de seguridad tiene que poder
-- ajustarlo cuando cambie el uso normal de la plataforma, sin un despliegue.
CREATE TABLE IF NOT EXISTS anomaly_rules (
    code            VARCHAR(50) PRIMARY KEY,
    description     TEXT,

    -- Por ahora un solo tipo. Se deja explicito para que agregar otro
    -- (por ejemplo "demasiados ajustes manuales sobre el mismo usuario") sea
    -- una fila mas y un calculador mas, no un rediseno.
    rule_type       VARCHAR(30) NOT NULL DEFAULT 'points_rate'
                    CHECK (rule_type IN ('points_rate')),

    -- Ventana deslizante y techo de puntos dentro de ella.
    window_minutes  INT NOT NULL CHECK (window_minutes > 0),
    max_points      INT NOT NULL CHECK (max_points > 0),

    severity        VARCHAR(10) NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low','medium','high','critical')),

    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dos umbrales sobre la misma ventana, con severidades distintas: uno avisa y
-- el otro alarma. Los valores son un punto de partida razonable para el
-- volumen de la plataforma (el desafio mas caro otorga 250 puntos), y se
-- esperan ajustar con datos reales.
INSERT INTO anomaly_rules (code, description, window_minutes, max_points, severity) VALUES
    ('tasa_alta',
     'Mas de 600 puntos en 60 minutos. Posible uso intensivo legitimo, pero conviene mirarlo.',
     60, 600, 'medium'),
    ('tasa_critica',
     'Mas de 1500 puntos en 60 minutos. Muy por encima de lo que permite completar el contenido disponible.',
     60, 1500, 'high')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Eventos detectados
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anomaly_events (
    id              BIGSERIAL PRIMARY KEY,

    -- Sin ON DELETE CASCADE: una alerta de seguridad no puede desaparecer
    -- porque se dio de baja al usuario investigado.
    user_id         INT NOT NULL REFERENCES users(id),

    rule_triggered  VARCHAR(50) NOT NULL,

    -- Criterio tecnico 2: las referencias a los movimientos de points_ledger
    -- involucrados. Es lo que permite el criterio de aceptacion 1: "ver el
    -- detalle del origen de esos puntos (leccion, quiz, ajuste manual)".
    --
    -- Se guarda el detalle completo y no solo los ids: si manana alguien
    -- corrige una regla de puntuacion, la evidencia debe seguir mostrando lo
    -- que se vio en el momento de la deteccion.
    evidence        JSONB NOT NULL DEFAULT '[]'::jsonb,

    severity        VARCHAR(10) NOT NULL
                    CHECK (severity IN ('low','medium','high','critical')),

    -- Unico campo que puede cambiar despues de creado.
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','reviewed','dismissed')),

    -- Criterio tecnico 6: idempotencia por source_id + rule_triggered.
    -- source_id es el id del movimiento de points_ledger que disparo la
    -- deteccion. Con esto, el job periodico puede reevaluar la misma ventana
    -- cuantas veces quiera sin duplicar alertas.
    source_id       VARCHAR(50),
    dedupe_key      VARCHAR(120) NOT NULL UNIQUE,

    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_events_pendientes
    ON anomaly_events (detected_at DESC) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_anomaly_events_usuario
    ON anomaly_events (user_id, detected_at DESC);

-- ---------------------------------------------------------------------
-- Inmutabilidad parcial
-- ---------------------------------------------------------------------
-- Criterio tecnico 2: "no debo permitir UPDATE ni DELETE sobre este registro,
-- solo actualizacion de su campo status mediante un endpoint controlado".
--
-- Un trigger que bloquee todo UPDATE haria imposible el cambio de estado; uno
-- que no bloquee nada dejaria reescribir la evidencia. Se bloquea el DELETE
-- siempre y el UPDATE solo si cambio algo que no sea `status`.
CREATE OR REPLACE FUNCTION fn_anomaly_events_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'anomaly_events es un registro de auditoria: no se puede eliminar. Para cerrar una alerta se cambia su status a reviewed o dismissed.';
    END IF;

    -- UPDATE: se compara fila contra fila ignorando el status. Si lo demas
    -- quedo igual, el cambio es legitimo.
    IF (NEW.id, NEW.user_id, NEW.rule_triggered, NEW.evidence, NEW.severity,
        NEW.source_id, NEW.dedupe_key, NEW.detected_at)
       IS DISTINCT FROM
       (OLD.id, OLD.user_id, OLD.rule_triggered, OLD.evidence, OLD.severity,
        OLD.source_id, OLD.dedupe_key, OLD.detected_at)
    THEN
        RAISE EXCEPTION
            'anomaly_events solo admite cambios en la columna status. La evidencia de una alerta no se reescribe.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_anomaly_events_inmutable ON anomaly_events;
CREATE TRIGGER trg_anomaly_events_inmutable
    BEFORE UPDATE OR DELETE ON anomaly_events
    FOR EACH ROW
    EXECUTE FUNCTION fn_anomaly_events_inmutable();

REVOKE DELETE, TRUNCATE ON anomaly_events FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Historial de estados
-- ---------------------------------------------------------------------
-- Criterio tecnico 5: el cambio de estado se registra "sin sobrescribir el
-- estado anterior". La columna status de anomaly_events dice como esta la
-- alerta HOY; esta tabla dice como llego hasta ahi.
CREATE TABLE IF NOT EXISTS anomaly_status_history (
    id              BIGSERIAL PRIMARY KEY,
    anomaly_id      BIGINT NOT NULL REFERENCES anomaly_events(id),

    previous_status VARCHAR(20) NOT NULL,
    new_status      VARCHAR(20) NOT NULL
                    CHECK (new_status IN ('pending','reviewed','dismissed')),

    -- Criterio de aceptacion 3: quien lo cambio y cuando.
    changed_by      INT NOT NULL REFERENCES users(id),
    note            TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_status_history_alerta
    ON anomaly_status_history (anomaly_id, changed_at DESC);

CREATE OR REPLACE FUNCTION fn_anomaly_status_history_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'anomaly_status_history es un historial inmutable: la operacion % no esta permitida.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_anomaly_status_history_inmutable ON anomaly_status_history;
CREATE TRIGGER trg_anomaly_status_history_inmutable
    BEFORE UPDATE OR DELETE ON anomaly_status_history
    FOR EACH ROW
    EXECUTE FUNCTION fn_anomaly_status_history_inmutable();

REVOKE UPDATE, DELETE, TRUNCATE ON anomaly_status_history FROM PUBLIC;
