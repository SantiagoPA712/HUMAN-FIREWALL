-- =====================================================================
-- 031_report_permissions.sql
-- Modelo de permisos por rol para reportes, historial inmutable y auditoria.
-- =====================================================================

CREATE TABLE IF NOT EXISTS report_permissions (
    id          BIGSERIAL PRIMARY KEY,
    role        VARCHAR(50) NOT NULL,
    resource    VARCHAR(50) NOT NULL
                CHECK (resource IN ('performance', 'anomalies', 'organizational', 'dashboard')),
    action      VARCHAR(30) NOT NULL
                CHECK (action IN ('view', 'export', 'modify')),
    allowed     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_report_permissions_role_resource_action UNIQUE (role, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_report_permissions_lookup
    ON report_permissions (role, resource, action);

-- ---------------------------------------------------------------------
-- Historial inmutable de modificaciones de permisos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_permissions_history (
    id              BIGSERIAL PRIMARY KEY,
    changed_by      INT NOT NULL REFERENCES users(id),
    resource        VARCHAR(50) NOT NULL,
    action          VARCHAR(30),
    previous_value  JSONB,
    new_value       JSONB,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_permissions_history_ts
    ON report_permissions_history (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_report_permissions_history_user
    ON report_permissions_history (changed_by, timestamp DESC);

-- Trigger de inmutabilidad: rechaza cualquier UPDATE o DELETE a nivel BD
CREATE OR REPLACE FUNCTION fn_report_permissions_history_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'report_permissions_history es un registro inmutable: la operacion % no esta permitida. Las modificaciones se registran como nuevas entradas.',
        TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_permissions_history_inmutable ON report_permissions_history;
CREATE TRIGGER trg_report_permissions_history_inmutable
    BEFORE UPDATE OR DELETE ON report_permissions_history
    FOR EACH ROW
    EXECUTE FUNCTION fn_report_permissions_history_inmutable();

REVOKE UPDATE, DELETE, TRUNCATE ON report_permissions_history FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Registro de auditoria de accesos/permisos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id),
    resource    VARCHAR(50) NOT NULL,
    action      VARCHAR(30) NOT NULL,
    result      VARCHAR(20) NOT NULL CHECK (result IN ('allowed', 'denied')),
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perm_audit_log_user ON permission_audit_log (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_perm_audit_log_resource ON permission_audit_log (resource, timestamp DESC);

-- Permisos iniciales por defecto
INSERT INTO report_permissions (role, resource, action, allowed) VALUES
    ('admin', 'performance', 'view', true),
    ('admin', 'performance', 'export', true),
    ('admin', 'performance', 'modify', true),
    ('admin', 'anomalies', 'view', true),
    ('admin', 'anomalies', 'export', true),
    ('admin', 'anomalies', 'modify', true),
    ('admin', 'organizational', 'view', true),
    ('admin', 'organizational', 'export', true),
    ('admin', 'organizational', 'modify', true),
    ('admin', 'dashboard', 'view', true),
    ('admin', 'dashboard', 'export', true),
    ('admin', 'dashboard', 'modify', true),
    ('rh', 'performance', 'view', true),
    ('rh', 'performance', 'export', true),
    ('rh', 'organizational', 'view', true),
    ('rh', 'organizational', 'export', true),
    ('rh', 'dashboard', 'view', true),
    ('security', 'anomalies', 'view', true),
    ('security', 'anomalies', 'export', true),
    ('security', 'anomalies', 'modify', true),
    ('security', 'dashboard', 'view', true),
    ('instructor', 'performance', 'view', true),
    ('instructor', 'dashboard', 'view', true),
    ('employee', 'performance', 'view', true),
    ('employee', 'dashboard', 'view', true)
ON CONFLICT (role, resource, action) DO NOTHING;
