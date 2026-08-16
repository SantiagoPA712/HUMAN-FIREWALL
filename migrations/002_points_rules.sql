-- =====================================================================
-- 002_points_rules.sql
-- Criterio tecnico 4: las reglas de puntuacion deben ser configurables
-- desde una tabla, no hardcodeadas.
-- Depende de: 001_points_ledger.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS points_rules (
    id           SERIAL PRIMARY KEY,

    -- Identificador estable que usa el codigo. Nunca se renombra.
    code         VARCHAR(50) NOT NULL UNIQUE,

    source_type  VARCHAR(20) NOT NULL
                 CHECK (source_type IN ('lesson','quiz','course','challenge','simulation','manual')),

    -- 'fixed'    -> otorga exactamente points
    -- 'by_score' -> otorga round(points * score / 100), para el criterio de
    --               aceptacion 2 ("puntos correspondientes segun el puntaje")
    points_mode  VARCHAR(20) NOT NULL DEFAULT 'fixed'
                 CHECK (points_mode IN ('fixed','by_score')),

    points       INT NOT NULL CHECK (points >= 0),

    -- Criterio de aceptacion 2: regla de negocio para repeticiones.
    -- false -> no se duplican puntos por el mismo logro.
    allow_repeat BOOLEAN NOT NULL DEFAULT false,

    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_points_rules_activas
    ON points_rules (source_type) WHERE is_active = true;

-- ---------------------------------------------------------------------
-- Reglas por defecto
-- ---------------------------------------------------------------------
-- Editables desde la BD sin tocar codigo. Los valores replican los que
-- hoy estan hardcodeados en el sistema.

INSERT INTO points_rules (code, source_type, points_mode, points, allow_repeat, description) VALUES
    ('lesson.completed',  'lesson',     'fixed',    10, false, 'Puntos por completar una leccion. Si la leccion define points_reward, ese valor tiene prioridad.'),
    ('quiz.approved',     'quiz',       'by_score', 100, false, 'Puntos por aprobar una evaluacion, proporcionales al puntaje obtenido.'),
    ('course.completed',  'course',     'fixed',    50, false, 'Puntos por finalizar un curso completo.'),
    ('challenge.won',     'challenge',  'fixed',     0, false, 'Puntos por superar un desafio. El valor real sale de challenges.points_reward.'),
    ('simulation.step',   'simulation', 'fixed',     0, true,  'Puntos por decision correcta en una simulacion. El valor sale de simulation_options.points_awarded.')
ON CONFLICT (code) DO NOTHING;
