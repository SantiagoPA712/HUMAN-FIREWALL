-- =====================================================================
-- 001_points_ledger.sql
-- HU: Asignacion automatica de puntos
-- Criterio de aceptacion 3: historial de puntos inmutable.
-- Criterio tecnico 2: solo INSERT, nunca UPDATE ni DELETE.
-- =====================================================================

CREATE TABLE IF NOT EXISTS points_ledger (
    id              BIGSERIAL PRIMARY KEY,

    -- Sin ON DELETE CASCADE a proposito: si se pudiera borrar en cascada,
    -- el historial dejaria de ser inmutable. Los usuarios se desactivan
    -- con is_active = false, no se borran.
    user_id         INT NOT NULL REFERENCES users(id),

    source_type     VARCHAR(20) NOT NULL
                    CHECK (source_type IN ('lesson','quiz','course','challenge','simulation','manual')),
    source_id       VARCHAR(50),

    points          INT NOT NULL,

    -- Que regla de points_rules genero este movimiento.
    rule_code       VARCHAR(50),

    -- Evita duplicados ante reintentos de la cola de eventos.
    -- Formato: '<source_type>:<user_id>:<source_id>[:<intento>]'
    idempotency_key VARCHAR(200) NOT NULL UNIQUE,

    -- Timestamp del servidor de base de datos. Nunca se acepta del cliente.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_points_ledger_user_fecha
    ON points_ledger (user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Inmutabilidad
-- ---------------------------------------------------------------------
-- El REVOKE de mas abajo no alcanza por si solo: en Supabase la aplicacion
-- suele conectarse con un rol de altos privilegios, y los superusuarios
-- ignoran los permisos de tabla. El trigger si se aplica a todos los roles,
-- asi que esa es la garantia real.

CREATE OR REPLACE FUNCTION fn_points_ledger_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'points_ledger es un historial inmutable: la operacion % no esta permitida. Para corregir un movimiento, insertar uno compensatorio con points negativo.',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_points_ledger_inmutable ON points_ledger;
CREATE TRIGGER trg_points_ledger_inmutable
    BEFORE UPDATE OR DELETE ON points_ledger
    FOR EACH ROW
    EXECUTE FUNCTION fn_points_ledger_inmutable();

-- Defensa en profundidad a nivel de permisos.
REVOKE UPDATE, DELETE, TRUNCATE ON points_ledger FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Recalculo del total desde el historial
-- ---------------------------------------------------------------------
-- Criterio de aceptacion 3: el total debe poder recalcularse en cualquier
-- momento a partir del historial. users.total_points pasa a ser solo una
-- cache; esta vista es la fuente de verdad.

CREATE OR REPLACE VIEW v_user_points AS
SELECT
    u.id                                   AS user_id,
    COALESCE(SUM(pl.points), 0)::INT       AS total_points,
    COUNT(pl.id)::INT                      AS movimientos,
    MAX(pl.created_at)                     AS ultimo_movimiento
FROM users u
LEFT JOIN points_ledger pl ON pl.user_id = u.id
GROUP BY u.id;
