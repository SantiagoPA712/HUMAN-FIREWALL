-- =====================================================================
-- 030_audit_log.sql
-- HU: deteccion de abuso del sistema de puntos.
-- Criterio de aceptacion 2: si un administrador modifica puntos, nivel o
-- insignias de un usuario de forma manual, el cambio queda registrado con
-- responsable, fecha y motivo, y ese registro no se puede editar ni eliminar.
-- Criterio tecnico 4: INSERT-only, con actor_id, target_user_id, change_type,
-- previous_value, new_value, reason y timestamp.
--
-- Por que hace falta:
--
-- Hoy un administrador puede otorgar insignias (POST /badges/assign) sin que
-- quede rastro de quien lo hizo ni por que. Los puntos manuales tampoco: el
-- source_type 'manual' de points_ledger existe desde la migracion 001, pero
-- solo guarda que el movimiento fue manual, no quien lo ordeno.
--
-- Un panel de seguridad que no puede responder "quien le dio 5000 puntos a
-- esta persona y con que justificacion" no sirve para lo que se lo pide.
--
-- Depende de: schema.sql (users)
-- =====================================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,

    -- Quien ejecuto el cambio. Sin ON DELETE CASCADE: la auditoria no puede
    -- borrarse porque se dio de baja al administrador que la genero, que es
    -- justamente el caso en el que mas importa conservarla.
    actor_id        INT NOT NULL REFERENCES users(id),

    -- Sobre quien. Puede ser NULL en cambios que no apuntan a una persona
    -- concreta (por ejemplo editar una regla), para que la tabla siga
    -- sirviendo si mas adelante se auditan otras cosas.
    target_user_id  INT REFERENCES users(id),

    change_type     VARCHAR(30) NOT NULL
                    CHECK (change_type IN ('points','level','badge','anomaly_status')),

    -- Valor antes y despues. JSONB y no texto porque un cambio de insignia no
    -- tiene la misma forma que uno de puntos, y forzarlos a un formato comun
    -- perderia informacion.
    previous_value  JSONB,
    new_value       JSONB,

    -- Criterio tecnico 4: obligatorio. El NOT NULL es la ultima linea de
    -- defensa; la validacion real esta en el controlador, que responde 400 y
    -- ni siquiera ejecuta el ajuste. Aca esta para que ningun camino futuro
    -- (un script, otro endpoint) pueda saltearse la exigencia.
    reason          TEXT NOT NULL CHECK (length(trim(reason)) > 0),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El log se consulta filtrando por actor y por tipo de cambio (mockup 3).
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
    ON audit_log (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_objetivo
    ON audit_log (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_tipo
    ON audit_log (change_type, created_at DESC);

-- ---------------------------------------------------------------------
-- INSERT-only
-- ---------------------------------------------------------------------
-- Un log de auditoria que el propio auditado puede editar no es un log de
-- auditoria. Mismo patron que points_ledger y user_rewards.
CREATE OR REPLACE FUNCTION fn_audit_log_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'audit_log es un registro inmutable: la operacion % no esta permitida. Un error se corrige con una entrada nueva, no reescribiendo la anterior.',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_inmutable ON audit_log;
CREATE TRIGGER trg_audit_log_inmutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION fn_audit_log_inmutable();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
