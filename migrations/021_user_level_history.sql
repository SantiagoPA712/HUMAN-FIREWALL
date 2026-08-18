-- =====================================================================
-- 021_user_level_history.sql
-- HU: Nivel actual y progreso hacia el siguiente nivel.
-- Criterio de aceptacion 2: el usuario debe ver un indicador de que subio
-- de nivel. Mockup 2: "historial de niveles alcanzados".
--
-- Por que una tabla y no calcularlo al vuelo:
-- el momento exacto en que el usuario cruzo un umbral no se puede
-- reconstruir despues, porque los umbrales de levels_config pueden cambiar.
-- Si manana se sube el minimo del nivel 3, un calculo derivado diria que el
-- usuario "nunca" alcanzo ese nivel en la fecha en que realmente lo festejo.
-- Por eso el hecho se registra cuando ocurre, con snapshot del nombre y del
-- umbral vigentes en ese instante, igual que user_rewards.
--
-- Tambien es lo que permite que la animacion de "subiste de nivel" se muestre
-- una sola vez: el frontend compara contra lo ya registrado.
--
-- Depende de: 020_levels_config.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_level_history (
    id           BIGSERIAL PRIMARY KEY,

    -- Sin ON DELETE CASCADE, por el mismo motivo que points_ledger: un
    -- historial que se puede borrar en cascada no es inmutable.
    user_id      INT NOT NULL REFERENCES users(id),

    level        INT NOT NULL CHECK (level > 0),

    -- Snapshot: como se llamaba el nivel y cual era su umbral cuando se
    -- alcanzo. Sin FK a levels_config a proposito, para que borrar un nivel
    -- del catalogo no arrastre el historial de nadie.
    level_name   VARCHAR(50),
    min_points   INT,

    -- Puntos que tenia el usuario en el momento de subir.
    points_at    INT NOT NULL,

    reached_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Un nivel se alcanza una sola vez por usuario. Si mas adelante pierde
    -- puntos y vuelve a subir, no se registra de nuevo: el historial cuenta
    -- que llego, no cuantas veces.
    UNIQUE (user_id, level)
);

CREATE INDEX IF NOT EXISTS idx_user_level_history_user
    ON user_level_history (user_id, reached_at DESC);

-- ---------------------------------------------------------------------
-- Inmutabilidad
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_user_level_history_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'user_level_history es un historial inmutable: la operacion % no esta permitida. Cambiar los umbrales de levels_config no debe reescribir los niveles ya alcanzados.',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_level_history_inmutable ON user_level_history;
CREATE TRIGGER trg_user_level_history_inmutable
    BEFORE UPDATE OR DELETE ON user_level_history
    FOR EACH ROW
    EXECUTE FUNCTION fn_user_level_history_inmutable();

REVOKE UPDATE, DELETE, TRUNCATE ON user_level_history FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Nivel de arranque
-- ---------------------------------------------------------------------
-- Todo usuario existente arranca en el nivel mas bajo del catalogo. Sin esta
-- fila, la primera vez que gane puntos el sistema registraria "subio al nivel
-- 1" como si fuera un logro, cuando en realidad ya estaba ahi.
INSERT INTO user_level_history (user_id, level, level_name, min_points, points_at)
SELECT u.id, l.level, l.name, l.min_points, 0
  FROM users u
 CROSS JOIN (SELECT level, name, min_points FROM levels_config
              WHERE is_active = true ORDER BY min_points LIMIT 1) l
ON CONFLICT (user_id, level) DO NOTHING;
