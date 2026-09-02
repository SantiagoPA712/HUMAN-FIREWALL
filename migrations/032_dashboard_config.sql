-- =====================================================================
-- 032_dashboard_config.sql
-- Configuracion personalizada de widgets de dashboard por usuario.
-- =====================================================================

CREATE TABLE IF NOT EXISTS dashboard_configs (
    user_id     INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    widgets     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_configs_user
    ON dashboard_configs (user_id);
