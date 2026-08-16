-- =====================================================================
-- 003_lesson_quiz_tracking.sql
-- Origen de los eventos lesson.completed y quiz.approved.
-- El sistema no registraba en ningun lado que un usuario hubiera
-- completado una leccion ni que hubiera aprobado una evaluacion, asi que
-- no habia sobre que disparar la asignacion de puntos.
--
-- Mapeo adoptado:
--   leccion    -> course_contents (ya tiene points_reward, sin usar hasta ahora)
--   evaluacion -> simulations y challenges existentes
--
-- Depende de: 001_points_ledger.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS lesson_completions (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_id   INT NOT NULL REFERENCES course_contents(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Una leccion se completa una sola vez por usuario.
    UNIQUE (user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_completions_user
    ON lesson_completions (user_id);

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id            SERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Referencia generica: id de simulacion (numerico) o de challenge (texto).
    quiz_ref      VARCHAR(50) NOT NULL,
    quiz_type     VARCHAR(20) NOT NULL
                  CHECK (quiz_type IN ('simulation','challenge')),

    score         INT NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    passing_score INT NOT NULL DEFAULT 60 CHECK (passing_score BETWEEN 0 AND 100),

    -- Criterio de aceptacion 2: no se asignan puntos si el intento fue reprobado.
    passed        BOOLEAN NOT NULL DEFAULT false,

    attempt_no    INT NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_quiz
    ON quiz_attempts (user_id, quiz_type, quiz_ref);

-- Permite responder rapido "el usuario ya aprobo esta evaluacion antes?",
-- que es la consulta que decide si se duplican puntos o no.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_aprobados
    ON quiz_attempts (user_id, quiz_type, quiz_ref) WHERE passed = true;
