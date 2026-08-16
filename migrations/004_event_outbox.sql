-- =====================================================================
-- 004_event_outbox.sql
-- Criterio tecnico 1: el servicio de gamificacion debe consumir los
-- eventos de forma asincrona, sin bloquear la respuesta de la accion
-- original.
--
-- Patron outbox: la accion original solo INSERTA el evento (rapido, dentro
-- de su propia transaccion) y responde. Un worker aparte lo procesa. Si el
-- proceso se cae, el evento sigue en la tabla y se reintenta al arrancar.
--
-- Depende de: 001_points_ledger.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS event_outbox (
    id           BIGSERIAL PRIMARY KEY,

    -- 'lesson.completed', 'quiz.approved', 'course.completed', 'points_assigned'
    event_name   VARCHAR(50) NOT NULL,
    payload      JSONB NOT NULL,

    status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','done','failed')),

    attempts     INT NOT NULL DEFAULT 0,
    last_error   TEXT,

    -- Momento a partir del cual el evento puede volver a intentarse.
    -- Sin esto, un evento que falla se reintenta en el mismo ciclo del worker
    -- y agota todos sus intentos en milisegundos, sin darle tiempo a que se
    -- recupere la causa del fallo (por ejemplo, la base caida un instante).
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

-- Indice parcial: el worker solo consulta los pendientes, que son pocos
-- frente al total historico.
CREATE INDEX IF NOT EXISTS idx_event_outbox_pendientes
    ON event_outbox (next_attempt_at, created_at) WHERE status = 'pending';
