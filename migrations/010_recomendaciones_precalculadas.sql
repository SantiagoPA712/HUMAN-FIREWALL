-- =====================================================================
-- 010_recomendaciones_precalculadas.sql
-- Arquitectura basada en eventos: proyeccion de recomendaciones.
--
-- Hasta ahora las recomendaciones se calculaban enteras en cada request de
-- /performance/:userId: seis consultas pesadas (evaluaciones, pendientes,
-- evolucion, avance de cursos, reglas y cursos de refuerzo) para responder
-- una pantalla que casi nunca cambia entre visitas.
--
-- Con eventos se invierte: el calculo se dispara cuando ocurre el hecho que
-- puede cambiarlo (quiz.approved, simulation.completed) y el resultado queda
-- guardado. La lectura pasa a ser un SELECT por clave primaria.
--
-- Esto es una PROYECCION, no una fuente de verdad: se puede borrar entera y
-- se reconstruye sola con el siguiente evento de cada usuario. Por eso no
-- lleva historial ni restricciones de negocio.
--
-- Depende de: schema.sql (users), 022_recommendation_rules.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_recommendations (
    -- Una sola fila vigente por usuario: la proyeccion se reemplaza, no se
    -- acumula. El historial de desempeno ya vive en quiz_attempts.
    user_id       INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    -- Que evento provoco este recalculo. Sirve para depurar por que una
    -- recomendacion quedo desactualizada.
    trigger_event VARCHAR(50),

    areas           JSONB NOT NULL DEFAULT '[]'::jsonb,
    recomendaciones JSONB NOT NULL DEFAULT '[]'::jsonb,

    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
