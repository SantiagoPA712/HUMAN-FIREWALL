-- =====================================================================
-- 025_equipos.sql
-- HU: Reportes de desempeno para RH.
-- Criterio de aceptacion 1: el reporte debe poder verse agregado "por equipo".
-- Criterio de aceptacion 2: filtro por area/equipo.
--
-- No habia forma de agrupar usuarios. La tabla users no tenia ninguna columna
-- de pertenencia organizacional, asi que "desempeno por equipo" era
-- irrepresentable: cualquier agrupacion habria salido de inventar una.
--
-- El documento de requisitos ya lo pedia (RI-01: "Departamento u organizacion
-- a la que pertenece"), solo que nunca se implemento.
--
-- Depende de: schema.sql (users)
-- =====================================================================

CREATE TABLE IF NOT EXISTS teams (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,

    -- Un equipo que se disuelve se desactiva, no se borra: si se borrara,
    -- los usuarios perderian su pertenencia historica y los reportes de
    -- fechas pasadas cambiarian de resultado.
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ON DELETE SET NULL y no CASCADE: borrar un equipo no puede llevarse por
-- delante a las personas que lo integraban.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS team_id INT REFERENCES teams(id) ON DELETE SET NULL;

-- El reporte filtra y agrupa por equipo en casi todas sus consultas.
CREATE INDEX IF NOT EXISTS idx_users_team
    ON users (team_id) WHERE team_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Equipos iniciales
-- ---------------------------------------------------------------------
-- Se siembran los equipos pero NO se asigna a nadie: repartir usuarios entre
-- areas seria inventar datos de la organizacion. La asignacion la hace RH
-- desde el panel, o con un UPDATE puntual.
--
-- Un usuario sin equipo no desaparece del reporte: aparece agrupado como
-- "Sin equipo", que ademas le sirve a RH para detectar altas incompletas.

INSERT INTO teams (id, name, description) VALUES
    (1, 'Tecnologia',       'Desarrollo, infraestructura y soporte tecnico'),
    (2, 'Finanzas',         'Contabilidad, tesoreria y control de gestion'),
    (3, 'Ventas',           'Comercial y atencion a clientes'),
    (4, 'Recursos Humanos', 'Seleccion, capacitacion y administracion de personal'),
    (5, 'Operaciones',      'Logistica y procesos internos')
ON CONFLICT (id) DO NOTHING;

-- Los ids se insertaron a mano y no movieron la secuencia: un equipo creado
-- desde el panel tomaria el id 1 y chocaria.
SELECT setval('teams_id_seq', GREATEST((SELECT MAX(id) FROM teams), 1));
