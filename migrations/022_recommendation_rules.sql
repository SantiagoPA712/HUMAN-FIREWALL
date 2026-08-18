-- =====================================================================
-- 022_recommendation_rules.sql
-- HU: Recomendaciones e indicadores para mejorar el desempeno.
-- Criterio tecnico 2: las recomendaciones se generan con una regla
-- CONFIGURABLE (ej. "puntaje < 70% -> sugerir leccion de refuerzo del mismo
-- curso"), sin modelo de machine learning en esta version.
--
-- Mismo enfoque que points_rules y rewards_catalog: el umbral vive en la
-- base, no en el codigo. Cambiar la exigencia de la organizacion es un
-- UPDATE, no un despliegue.
--
-- Depende de: 003_lesson_quiz_tracking.sql (quiz_attempts, lesson_progress)
-- =====================================================================

CREATE TABLE IF NOT EXISTS recommendation_rules (
    code              VARCHAR(50) PRIMARY KEY,
    description       TEXT,

    -- Por debajo de este puntaje, una evaluacion se considera area de
    -- oportunidad aunque haya sido aprobada. Es el "umbral definido" del
    -- criterio de aceptacion 2.
    score_threshold   INT NOT NULL DEFAULT 70
                      CHECK (score_threshold BETWEEN 0 AND 100),

    -- Si un intento reprobado entra siempre como area de oportunidad,
    -- independientemente del puntaje.
    include_failed    BOOLEAN NOT NULL DEFAULT true,

    -- Tope de sugerencias devueltas. Una lista larga no ayuda a "enfocar
    -- esfuerzos", que es el objetivo de la HU.
    max_suggestions   INT NOT NULL DEFAULT 5 CHECK (max_suggestions > 0),

    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Regla por defecto: la del enunciado.
INSERT INTO recommendation_rules (code, description, score_threshold, include_failed, max_suggestions)
VALUES (
    'refuerzo_por_puntaje_bajo',
    'Sugiere lecciones de refuerzo del mismo curso cuando una evaluacion se reprueba o queda por debajo del umbral.',
    70, true, 5
)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Indice de apoyo
-- ---------------------------------------------------------------------
-- El resumen recorre los intentos del usuario ordenados en el tiempo, para
-- comparar su progreso actual contra su propio historial (criterio de
-- aceptacion 1). 003 ya indexa (user_id, quiz_type, quiz_ref) y
-- (user_id, course_id), pero no el orden cronologico puro.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_fecha
    ON quiz_attempts (user_id, created_at);
