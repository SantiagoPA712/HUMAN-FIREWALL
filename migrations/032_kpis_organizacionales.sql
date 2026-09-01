-- =====================================================================
-- 032_kpis_organizacionales.sql
-- HU: "Yo como gerente quiero ver resultados organizacionales consolidados
-- del sistema de gamificacion para evaluar el impacto del programa en el
-- desempeno general de la organizacion."
--
-- Tres cosas que hoy no existen:
--
--   1. El rol 'manager'. El criterio tecnico 1 exige que el claim `role` del
--      JWT sea 'manager' o 'admin', y el CHECK de users.role (migraciones 005
--      y 028) no lo contempla: hoy es imposible crear un gerente.
--
--   2. org_kpi_snapshots. El criterio tecnico 2 prohibe calcular los KPIs en
--      caliente sobre points_ledger. Hace falta donde dejar el precalculo.
--
--   3. org_report_access_log. El criterio tecnico 6 pide registrar cada
--      consulta a datos organizacionales.
--
-- Sobre "area": se reutiliza la tabla teams de la migracion 025, que ya
-- representa el area/departamento de cada persona (users.team_id). Crear una
-- tabla areas paralela partiria la organizacion en dos jerarquias que habria
-- que mantener sincronizadas a mano.
--
-- Depende de: 005_rol_rh.sql y 028_rol_seguridad.sql (el CHECK que se amplia),
--             025_equipos.sql (teams)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Rol de gerencia
-- ---------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_role;
ALTER TABLE users ADD CONSTRAINT chk_users_role
    CHECK (role IN ('employee','instructor','admin','rh','security','manager'));

-- Cuenta de gerencia, en la misma linea de 027 y 028: la pantalla tiene que
-- ser alcanzable sin tocar la base a mano.
--
-- Hash generado con el bcrypt del proyecto (cost 10) y verificado contra su
-- contrasena antes de escribirlo aca:
--
--   gerencia@humanfirewall.com  ->  Gerente123
--
-- AVISO: credenciales de DESARROLLO, publicadas en el repositorio. Cambiarlas
-- antes de exponer el sistema.
INSERT INTO users (email, password, role, is_active, team_id)
VALUES ('gerencia@humanfirewall.com',
        '$2b$10$XjjjovSkihJy5T.K.e7Ju.BiZ8YbqckaRHqgzFvkonguR.ph5n80y',
        'manager', true, NULL)
ON CONFLICT (email) DO UPDATE
   SET password  = EXCLUDED.password,
       role      = 'manager',
       is_active = true;

-- ---------------------------------------------------------------------
-- Snapshots de KPIs
-- ---------------------------------------------------------------------
-- Criterio tecnico 2: el endpoint organizacional lee de aca, nunca de
-- points_ledger. La diferencia no es de estilo: el reporte consolida a toda
-- la organizacion, y hacerlo en caliente significa recorrer el historial
-- completo de movimientos cada vez que un gerente abre el dashboard.
--
-- Criterio tecnico 3: cada corrida del job INSERTA. No hay UNIQUE sobre
-- (period, area_id, kpi_type) a proposito: eso obligaria a un UPSERT, y
-- "sin sobrescribir snapshots anteriores" es exactamente lo contrario. La
-- lectura toma el snapshot mas reciente de cada combinacion (DISTINCT ON),
-- y los anteriores quedan como historia de como se movio el numero.
CREATE TABLE IF NOT EXISTS org_kpi_snapshots (
    id            BIGSERIAL PRIMARY KEY,

    -- Periodo consolidado, en formato YYYY-MM. Es el grano con el que la HU
    -- habla de comparar ("mes actual vs anterior").
    period        VARCHAR(20) NOT NULL,

    -- NULL = toda la organizacion. Es la fila que alimenta la vista
    -- consolidada; las demas alimentan el filtro por area.
    --
    -- ON DELETE SET NULL seria un error aca: convertiria el snapshot de un
    -- area borrada en un snapshot de "toda la organizacion" y arruinaria los
    -- totales historicos. Se restringe el borrado.
    area_id       INT REFERENCES teams(id) ON DELETE RESTRICT,

    kpi_type      VARCHAR(40) NOT NULL
                  CHECK (kpi_type IN ('participacion', 'progreso_promedio',
                                      'cursos_completados', 'engagement')),

    -- NUMERIC y no INT: participacion y engagement son promedios y
    -- porcentajes, redondearlos a entero perderia el movimiento chico que es
    -- justo lo que se quiere comparar entre periodos.
    value         NUMERIC(12, 2) NOT NULL,

    -- Numerador y denominador con los que salio el valor. Sin esto, un KPI
    -- que se movio no se puede explicar: no se sabe si subio porque mejoro la
    -- gente o porque bajo el padron.
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,

    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La consulta del dashboard es siempre la misma: dame el ultimo snapshot de
-- cada kpi_type para este periodo y esta area.
CREATE INDEX IF NOT EXISTS idx_org_kpi_snapshots_lectura
    ON org_kpi_snapshots (period, area_id, kpi_type, calculated_at DESC);

-- El grafico de tendencia recorre varios periodos de una misma area.
CREATE INDEX IF NOT EXISTS idx_org_kpi_snapshots_tendencia
    ON org_kpi_snapshots (kpi_type, area_id, period);

-- ---------------------------------------------------------------------
-- Bitacora de consultas organizacionales
-- ---------------------------------------------------------------------
-- Criterio tecnico 6: "debo registrar en logs internos: el ID del
-- solicitante, los parametros de consulta (periodo, area) y el timestamp del
-- servidor. Y estos registros no deben ser accesibles desde el frontend ni
-- expuestos en ninguna respuesta de la API."
--
-- La segunda mitad es la que manda el diseno: no hay, y no debe haber, ningun
-- endpoint que lea esta tabla. Se consulta con acceso directo a la base.
--
-- Mismo patron INSERT-only que audit_log (030): una bitacora que el propio
-- consultado puede editar no es una bitacora.
CREATE TABLE IF NOT EXISTS org_report_access_log (
    id           BIGSERIAL PRIMARY KEY,

    -- Sin ON DELETE CASCADE: el rastro no desaparece porque se dio de baja a
    -- quien consulto.
    requested_by INT NOT NULL REFERENCES users(id),

    -- Los parametros, desglosados para poder filtrar por ellos, y completos
    -- en params por si manana la consulta acepta uno mas.
    period       VARCHAR(20),
    compare_to   VARCHAR(20),
    area_id      INT,
    params       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Criterio 6: timestamp del SERVIDOR. Nunca uno que mande el cliente.
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_access_log_solicitante
    ON org_report_access_log (requested_by, requested_at DESC);

CREATE OR REPLACE FUNCTION fn_org_access_log_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'org_report_access_log es una bitacora inmutable: la operacion % no esta permitida.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_access_log_inmutable ON org_report_access_log;
CREATE TRIGGER trg_org_access_log_inmutable
    BEFORE UPDATE OR DELETE ON org_report_access_log
    FOR EACH ROW
    EXECUTE FUNCTION fn_org_access_log_inmutable();

REVOKE UPDATE, DELETE, TRUNCATE ON org_report_access_log FROM PUBLIC;
