-- =====================================================================
-- 020_levels_config.sql
-- HU: Nivel actual y progreso hacia el siguiente nivel.
-- Criterio tecnico 1: los umbrales de puntos que definen cada nivel viven
-- en una tabla parametrizable, no en el codigo.
--
-- Solo se guarda el limite INFERIOR de cada nivel (min_points). El limite
-- superior es, por definicion, el min_points del nivel siguiente menos uno.
-- Guardar los dos extremos permitiria dejar huecos ("nivel 1: 0-100,
-- nivel 2: 150-300": los puntajes 101-149 no serian de ningun nivel) o
-- solapamientos, y no hay forma de impedirlo con una restriccion simple.
-- Con un solo borde eso es imposible de representar.
--
-- El enunciado de la HU pide "nivel 1: 0-100, nivel 2: 101-300". Con este
-- modelo se expresa como min_points 0 y 101: el nivel 1 cubre 0..100 porque
-- el 2 arranca en 101.
--
-- Depende de: 001_points_ledger.sql (la vista v_user_points)
-- =====================================================================

CREATE TABLE IF NOT EXISTS levels_config (
    level       INT PRIMARY KEY CHECK (level > 0),

    name        VARCHAR(50) NOT NULL,
    description TEXT,
    icon_url    VARCHAR(255),

    -- Puntos acumulados a partir de los cuales el usuario esta en este nivel.
    -- UNIQUE porque dos niveles no pueden empezar en el mismo puntaje: si lo
    -- hicieran, el nivel de un usuario seria ambiguo.
    min_points  INT NOT NULL UNIQUE CHECK (min_points >= 0),

    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El calculo del nivel busca "el mayor min_points que no supera mis puntos".
CREATE INDEX IF NOT EXISTS idx_levels_config_min_points
    ON levels_config (min_points) WHERE is_active = true;

-- ---------------------------------------------------------------------
-- Escalera inicial
-- ---------------------------------------------------------------------
-- Los dos primeros tramos son los del enunciado (0-100 y 101-300). Los
-- siguientes crecen de forma progresiva para que subir de nivel cueste cada
-- vez un poco mas.
--
-- Los nombres no se pisan con los de rewards_catalog ("Centinela",
-- "Guardian"): son dos escalas distintas y repetir nombres confundiria al
-- usuario en la interfaz.

INSERT INTO levels_config (level, name, min_points, description) VALUES
    (1, 'Novato',     0,    'Estas empezando. Complete su primera leccion para sumar puntos.'),
    (2, 'Aprendiz',   101,  'Ya conoce lo basico y suma puntos de forma constante.'),
    (3, 'Intermedio', 301,  'Maneja los conceptos centrales de ciberseguridad.'),
    (4, 'Avanzado',   701,  'Detecta amenazas con soltura y sostiene buenas practicas.'),
    (5, 'Experto',    1501, 'Referente de seguridad dentro de su equipo.'),
    (6, 'Maestro',    3001, 'Maximo nivel: firewall humano consolidado.')
ON CONFLICT (level) DO NOTHING;

-- ---------------------------------------------------------------------
-- users.level
-- ---------------------------------------------------------------------
-- La columna ya existia en schema.sql con DEFAULT 1 y nunca se calculaba:
-- el dashboard mostraba "Nivel 1" a todo el mundo (deuda tecnica 9).
--
-- Se conserva como CACHE, igual que users.total_points. La fuente de verdad
-- es el calculo derivado contra levels_config (criterio tecnico 3), porque
-- si manana se editan los umbrales, un valor almacenado quedaria mintiendo
-- hasta la proxima asignacion de puntos.
COMMENT ON COLUMN users.level IS
    'Cache del nivel derivado de points_ledger + levels_config. No es fuente de verdad: recalcular con levels.service.';
