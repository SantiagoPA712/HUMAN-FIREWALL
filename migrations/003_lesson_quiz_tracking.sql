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
-- La tabla se llama lesson_progress (y no lesson_completions) porque es el
-- nombre con el que la referencia la HU de recomendaciones personalizadas.
-- Hoy solo guarda lecciones completadas; si mas adelante hace falta registrar
-- avance parcial, se agrega una columna sin renombrar nada.
--
-- Depende de: 001_points_ledger.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS lesson_progress (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_id   INT NOT NULL REFERENCES course_contents(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Una leccion se completa una sola vez por usuario.
    UNIQUE (user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_user
    ON lesson_progress (user_id);

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id            SERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Referencia generica: id de simulacion (numerico) o de challenge (texto).
    quiz_ref      VARCHAR(50) NOT NULL,
    quiz_type     VARCHAR(20) NOT NULL
                  CHECK (quiz_type IN ('simulation','challenge')),

    -- Curso al que pertenecia la evaluacion en el momento del intento.
    -- Ni simulations ni challenges tienen relacion con courses en el esquema,
    -- asi que sin esta columna no hay forma de responder "sugerime una leccion
    -- de refuerzo del mismo tema", que es lo que necesita la HU de
    -- recomendaciones. Se guarda desnormalizado a proposito: es un historial,
    -- y debe conservar el contexto que tenia cuando ocurrio.
    course_id     INT REFERENCES courses(id) ON DELETE SET NULL,

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

-- Para el resumen de desempeno por curso de la HU de recomendaciones.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_curso
    ON quiz_attempts (user_id, course_id) WHERE course_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Enlace entre evaluaciones y cursos
-- ---------------------------------------------------------------------
-- Ni simulations ni challenges tenian relacion con courses. Sin ese enlace,
-- quiz_attempts.course_id no se podria completar nunca y la HU de
-- recomendaciones no tendria como saber que leccion de refuerzo sugerir
-- ante una evaluacion con puntaje bajo.
--
-- Ambas columnas son nullable: hoy los desafios del portal no pertenecen a
-- ningun curso, y eso es valido.

ALTER TABLE simulations
    ADD COLUMN IF NOT EXISTS course_id INT REFERENCES courses(id) ON DELETE SET NULL;

ALTER TABLE challenges
    ADD COLUMN IF NOT EXISTS course_id INT REFERENCES courses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_simulations_curso
    ON simulations (course_id) WHERE course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_challenges_curso
    ON challenges (course_id) WHERE course_id IS NOT NULL;
