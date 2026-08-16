-- =====================================================================
-- 007_user_rewards.sql
-- Criterio de aceptacion 3: historial de recompensas inmutable.
-- Criterio tecnico 3: si una recompensa se edita o se elimina del catalogo,
-- los registros ya otorgados conservan un snapshot de como estaba.
--
-- FALLO CORREGIDO: user_badges.badge_id tenia ON DELETE CASCADE. Borrar una
-- insignia del catalogo borraba el historial de TODOS los usuarios que la
-- habian ganado, en silencio. Es exactamente lo que el criterio 3 prohibe.
--
-- Depende de: 006_rewards_catalog.sql
-- =====================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user_badges')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user_rewards')
    THEN
        ALTER TABLE user_badges RENAME TO user_rewards;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_rewards (
    id        SERIAL PRIMARY KEY,
    user_id   INT NOT NULL REFERENCES users(id),
    earned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'user_rewards' AND column_name = 'badge_id')
    THEN
        ALTER TABLE user_rewards RENAME COLUMN badge_id TO reward_id;
    END IF;
END $$;

ALTER TABLE user_rewards
    ADD COLUMN IF NOT EXISTS reward_id INT;

-- ---------------------------------------------------------------------
-- El historial deja de depender del catalogo
-- ---------------------------------------------------------------------
-- Se elimina el ON DELETE CASCADE y se reemplaza por SET NULL: si la
-- recompensa desaparece del catalogo, el registro del usuario sobrevive con
-- su snapshot intacto.

DO $$
DECLARE
    nombre_fk TEXT;
BEGIN
    FOR nombre_fk IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
         WHERE rel.relname = 'user_rewards'
           AND con.contype = 'f'
           AND pg_get_constraintdef(con.oid) ILIKE '%rewards_catalog%'
            OR (rel.relname = 'user_rewards' AND con.contype = 'f'
                AND pg_get_constraintdef(con.oid) ILIKE '%badges%')
    LOOP
        EXECUTE format('ALTER TABLE user_rewards DROP CONSTRAINT %I', nombre_fk);
    END LOOP;
END $$;

-- Deliberadamente NO se recrea la clave foranea.
--
-- Los dos criterios de la historia entran en conflicto si existe una FK:
--   * El historial debe ser inmutable (criterio de aceptacion 3).
--   * Borrar del catalogo no debe afectar lo ya otorgado (criterio tecnico 3).
--
-- ON DELETE SET NULL se ejecuta internamente como un UPDATE sobre
-- user_rewards, y el trigger de inmutabilidad lo rechaza: el DELETE sobre el
-- catalogo terminaba fallando entero. ON DELETE CASCADE era peor todavia:
-- borraba el historial, que es el fallo que esta migracion viene a corregir.
--
-- Sin FK, reward_id queda como referencia debil: sirve para enlazar con el
-- catalogo mientras la recompensa exista, y no significa nada cuando ya no
-- esta. Los datos que se muestran al usuario salen siempre del snapshot
-- (reward_name, reward_description, reward_icon_url), que por definicion no
-- depende del catalogo.
--
-- Para retirar una recompensa de circulacion sin romper nada, marcarla como
-- is_active = false en lugar de borrarla.
CREATE INDEX IF NOT EXISTS idx_user_rewards_catalogo
    ON user_rewards (reward_id) WHERE reward_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Snapshot: como se llamaba la recompensa cuando se otorgo
-- ---------------------------------------------------------------------
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS reward_name        VARCHAR(100);
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS reward_description TEXT;
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS reward_icon_url    VARCHAR(255);

-- Origen del logro: que accion la disparo.
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS source_type VARCHAR(30);
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS source_id   VARCHAR(50);

-- Condicion que se cumplio, para la vista de detalle.
ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS condition_snapshot JSONB;

-- Completa el snapshot de las filas que ya existian.
UPDATE user_rewards ur
   SET reward_name        = COALESCE(ur.reward_name, rc.name),
       reward_description = COALESCE(ur.reward_description, rc.description),
       reward_icon_url    = COALESCE(ur.reward_icon_url, rc.icon_url),
       source_type        = COALESCE(ur.source_type, 'manual')
  FROM rewards_catalog rc
 WHERE rc.id = ur.reward_id
   AND ur.reward_name IS NULL;

-- Red de seguridad: una fila huerfana (reward_id nulo) no puede tomar el
-- nombre del catalogo, y sin esto el SET NOT NULL abortaria la migracion.
UPDATE user_rewards SET reward_name = 'Recompensa (registro historico)'
 WHERE reward_name IS NULL;

ALTER TABLE user_rewards ALTER COLUMN reward_name SET NOT NULL;

-- ---------------------------------------------------------------------
-- Control de duplicados
-- ---------------------------------------------------------------------
-- El UNIQUE(user_id, badge_id) original impedia por completo las recompensas
-- repetibles. Se reemplaza por una clave que el servicio arma segun el caso:
--   no repetible -> 'reward:<reward_id>:<user_id>'          (una sola vez)
--   repetible    -> 'reward:<reward_id>:<user_id>:<origen>' (una por logro)

ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(200);

UPDATE user_rewards
   SET dedupe_key = 'reward:' || COALESCE(reward_id::text, 'x') || ':' || user_id::text
 WHERE dedupe_key IS NULL;

DO $$
DECLARE
    nombre_uq TEXT;
BEGIN
    FOR nombre_uq IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
         WHERE rel.relname = 'user_rewards'
           AND con.contype = 'u'
    LOOP
        EXECUTE format('ALTER TABLE user_rewards DROP CONSTRAINT %I', nombre_uq);
    END LOOP;
END $$;

ALTER TABLE user_rewards ALTER COLUMN dedupe_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_rewards_dedupe
    ON user_rewards (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_user_rewards_usuario
    ON user_rewards (user_id, earned_at DESC);

-- ---------------------------------------------------------------------
-- Inmutabilidad
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_user_rewards_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'user_rewards es un historial inmutable: la operacion % no esta permitida. Editar o eliminar una recompensa del catalogo no debe afectar lo ya otorgado.',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_rewards_inmutable ON user_rewards;
CREATE TRIGGER trg_user_rewards_inmutable
    BEFORE UPDATE OR DELETE ON user_rewards
    FOR EACH ROW
    EXECUTE FUNCTION fn_user_rewards_inmutable();

REVOKE UPDATE, DELETE, TRUNCATE ON user_rewards FROM PUBLIC;
