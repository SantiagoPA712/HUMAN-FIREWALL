-- =====================================================================
-- 006_rewards_catalog.sql
-- HU: Asignacion de recompensas e insignias por cumplimiento de logros.
-- Criterio tecnico 1: catalogo con nombre, descripcion, tipo de condicion,
-- umbral/parametros y si es repetible.
--
-- La tabla `badges` ya existia pero solo soportaba una condicion posible
-- (points_required) y no sabia de repetibles ni de activacion. Se renombra y
-- se extiende en lugar de crear una tabla paralela, para no dejar dos
-- sistemas de insignias conviviendo.
--
-- Depende de: 001_points_ledger.sql
-- =====================================================================

-- Renombrado conservando los datos ya cargados.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'badges')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'rewards_catalog')
    THEN
        ALTER TABLE badges RENAME TO rewards_catalog;
    END IF;
END $$;

-- Para instalaciones nuevas, donde `badges` nunca existio.
CREATE TABLE IF NOT EXISTS rewards_catalog (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    points_required INT DEFAULT 0,
    icon_url        VARCHAR(255)
);

-- ---------------------------------------------------------------------
-- Extension del catalogo
-- ---------------------------------------------------------------------

-- Que hay que cumplir para ganarla.
--   points_total        -> total acumulado >= threshold
--   courses_completed   -> cantidad de cursos finalizados >= threshold
--   lessons_completed   -> cantidad de lecciones completadas >= threshold
--   quizzes_approved    -> cantidad de evaluaciones aprobadas >= threshold
--   quiz_streak         -> racha de evaluaciones aprobadas seguidas >= threshold
ALTER TABLE rewards_catalog
    ADD COLUMN IF NOT EXISTS condition_type VARCHAR(30) NOT NULL DEFAULT 'points_total';

-- Parametros de la condicion, por ejemplo {"threshold": 500}.
-- Va en JSONB para que agregar un tipo de condicion nuevo no requiera
-- cambiar el esquema.
ALTER TABLE rewards_catalog
    ADD COLUMN IF NOT EXISTS condition_params JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Criterio de aceptacion 2: una recompensa no repetible se otorga una sola vez.
ALTER TABLE rewards_catalog
    ADD COLUMN IF NOT EXISTS is_repeatable BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE rewards_catalog
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE rewards_catalog
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE rewards_catalog
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE rewards_catalog DROP CONSTRAINT IF EXISTS chk_rewards_condition_type;
ALTER TABLE rewards_catalog ADD CONSTRAINT chk_rewards_condition_type
    CHECK (condition_type IN (
        'points_total', 'courses_completed', 'lessons_completed',
        'quizzes_approved', 'quiz_streak'
    ));

-- Las insignias que ya existian solo sabian de puntos acumulados: se traduce
-- su points_required al nuevo formato de parametros.
UPDATE rewards_catalog
   SET condition_params = jsonb_build_object('threshold', COALESCE(points_required, 0))
 WHERE condition_params = '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_rewards_catalog_activas
    ON rewards_catalog (condition_type) WHERE is_active = true;

-- ---------------------------------------------------------------------
-- Catalogo por defecto
-- ---------------------------------------------------------------------
INSERT INTO rewards_catalog (name, description, condition_type, condition_params, is_repeatable, icon_url)
SELECT * FROM (VALUES
    ('Primeros Pasos',      'Completaste tu primera leccion',              'lessons_completed', '{"threshold": 1}'::jsonb,   false, null::varchar),
    ('Aprendiz Constante',  'Completaste 10 lecciones',                    'lessons_completed', '{"threshold": 10}'::jsonb,  false, null),
    ('Centinela',           'Alcanzaste 500 puntos de seguridad',          'points_total',      '{"threshold": 500}'::jsonb, false, null),
    ('Guardian',            'Alcanzaste 2000 puntos de seguridad',         'points_total',      '{"threshold": 2000}'::jsonb,false, null),
    ('Sin Fallar',          'Aprobaste 3 evaluaciones seguidas',           'quiz_streak',       '{"threshold": 3}'::jsonb,   true,  null),
    ('Curso Completo',      'Finalizaste tu primer curso',                 'courses_completed', '{"threshold": 1}'::jsonb,   false, null)
) AS nuevas(name, description, condition_type, condition_params, is_repeatable, icon_url)
WHERE NOT EXISTS (SELECT 1 FROM rewards_catalog rc WHERE rc.name = nuevas.name);
