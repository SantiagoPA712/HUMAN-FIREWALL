-- =====================================================================
-- 031_reportes_programados.sql
-- HU: "Yo como sistema quiero generar reportes automaticos de forma
-- periodica para que RH, seguridad y gerencia reciban informacion
-- actualizada sin necesidad de generarla manualmente."
--
-- Tres tablas, una por responsabilidad:
--
--   report_schedules     -> QUE se genera, cada cuanto y para quien
--   report_history       -> QUE se genero, con que resultado (criterio 3)
--   report_notifications -> el envio del aviso, con sus reintentos (criterio 4)
--
-- Por que la exportacion manual (026) no alcanzaba: report_exports guarda
-- quien pidio un archivo y con que filtros, pero no existe nada que diga
-- "este reporte se genera solo, todos los lunes, para RH". Sin programacion
-- ni periodo, el criterio de idempotencia ("ya existe un reporte para este
-- schedule_id y periodo") no tiene contra que compararse.
--
-- Depende de: schema.sql (users), 025_equipos.sql (teams, para los filtros)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Programaciones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_schedules (
    id               BIGSERIAL PRIMARY KEY,

    name             VARCHAR(120) NOT NULL,

    -- Los dos tipos que el sistema sabe generar hoy. Agregar uno mas es una
    -- fila en el CHECK y un generador en scheduledReports.service, no un
    -- rediseno de la tabla.
    report_type      VARCHAR(50) NOT NULL
                     CHECK (report_type IN ('performance', 'organizational')),

    frequency        VARCHAR(20) NOT NULL
                     CHECK (frequency IN ('daily', 'weekly', 'monthly')),

    format           VARCHAR(10) NOT NULL DEFAULT 'csv'
                     CHECK (format IN ('csv', 'pdf')),

    -- Filtros del reporte (equipo, curso, rango propio si se quiere fijar
    -- uno). Se validan con reports.service.validarFiltros ANTES de guardar la
    -- programacion: un team_id inexistente se rechaza al configurarla, no
    -- semanas despues cuando el job falle a las 3 de la manana.
    params           JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Criterio de aceptacion 2: "los roles suscritos". Se guardan roles y no
    -- usuarios concretos: si manana entra alguien nuevo a RH, recibe el
    -- reporte sin que nadie tenga que acordarse de agregarlo a una lista.
    subscriber_roles TEXT[] NOT NULL DEFAULT ARRAY['rh']::text[],

    is_active        BOOLEAN NOT NULL DEFAULT true,

    -- Criterio tecnico 1: el scheduler dispara cuando se cumple next_run_at,
    -- y lo adelanta INMEDIATAMENTE al encolar para no disparar dos veces.
    next_run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_run_at      TIMESTAMPTZ,

    created_by       INT REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El scheduler pregunta "que vencio" cada minuto. El indice parcial deja
-- fuera las programaciones desactivadas, que es la mayoria en cuanto el
-- sistema lleve tiempo andando.
CREATE INDEX IF NOT EXISTS idx_report_schedules_vencidas
    ON report_schedules (next_run_at) WHERE is_active = true;

-- ---------------------------------------------------------------------
-- Historico de generaciones
-- ---------------------------------------------------------------------
-- Criterio tecnico 3: se inserta una fila termine como termine el job, con
-- schedule_id, type, params_used, status, generated_at y file_location.
--
-- Se guarda params_used y no solo un puntero a report_schedules.params
-- porque la programacion se puede editar: si RH cambia el equipo filtrado,
-- el historico tiene que seguir diciendo con que filtros se genero CADA
-- archivo, no con cuales se generaria hoy.
CREATE TABLE IF NOT EXISTS report_history (
    id             BIGSERIAL PRIMARY KEY,

    -- Sin ON DELETE CASCADE: borrar una programacion no puede llevarse el
    -- historico de lo que ya se genero y se distribuyo.
    schedule_id    BIGINT REFERENCES report_schedules(id),

    type           VARCHAR(50) NOT NULL,

    -- Clave del periodo cubierto. La forma depende de la frecuencia:
    --   diaria   -> 2026-08-31
    --   semanal  -> 2026-W35
    --   mensual  -> 2026-08
    --
    -- Es la mitad de la clave de idempotencia del criterio tecnico 2. Se
    -- guarda como texto y no como rango de fechas a proposito: dos corridas
    -- del mismo periodo tienen que colisionar aunque una se haya ejecutado
    -- un minuto mas tarde que la otra.
    period         VARCHAR(20) NOT NULL,

    params_used    JSONB NOT NULL DEFAULT '{}'::jsonb,

    status         VARCHAR(20) NOT NULL CHECK (status IN ('success', 'error')),

    -- Ruta relativa al repositorio. NULL cuando el job fallo: no hay archivo.
    file_location  VARCHAR(255),
    row_count      INT,

    -- Criterio tecnico 5: aca va un resumen tecnico corto (el tipo de error y
    -- su mensaje), NO el stack trace. El stack va al log interno, que es el
    -- unico lugar donde puede vivir sin riesgo de terminar en una pantalla.
    error_summary  TEXT,

    -- Identificador con el que ese stack quedo registrado en el log. Es lo
    -- que permite que el aviso al equipo tecnico diga "buscar rep-a1b2c3" en
    -- vez de arrastrar el detalle interno dentro del mensaje.
    log_reference  VARCHAR(80),

    duration_ms    INT,
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Idempotencia (criterio tecnico 2)
-- ---------------------------------------------------------------------
-- "Si ya existe un reporte generado para ese schedule_id y periodo, no debo
-- generar un duplicado ni reenviar notificacion."
--
-- El indice es UNICO pero PARCIAL: solo aplica a las filas exitosas. Asi un
-- intento fallido no bloquea el reintento del mismo periodo, que es
-- justamente lo que se quiere (un job que fallo por un timeout tiene que
-- poder volver a correr), y a la vez dos exitos del mismo periodo son
-- imposibles a nivel de base, no solo a nivel de codigo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_history_periodo_exitoso
    ON report_history (schedule_id, period) WHERE status = 'success';

CREATE INDEX IF NOT EXISTS idx_report_history_reciente
    ON report_history (generated_at DESC);

-- ---------------------------------------------------------------------
-- Retencion explicita (criterio tecnico 3)
-- ---------------------------------------------------------------------
-- "Este registro no debe eliminarse automaticamente, solo mediante politica
-- de retencion explicita."
--
-- Un trigger que bloqueara todo DELETE cumpliria la primera mitad y haria
-- imposible la segunda. Se bloquea el borrado SALVO que la sesion declare
-- explicitamente que esta ejecutando la politica de retencion:
--
--   BEGIN;
--   SET LOCAL app.retencion_reportes = 'on';
--   DELETE FROM report_history WHERE generated_at < now() - interval '2 years';
--   COMMIT;
--
-- Es una linea que nadie escribe por accidente. Un ORM, un script de limpieza
-- generico o un DELETE distraido fallan; la politica de retencion, cuando
-- exista, pasa.
--
-- El UPDATE se bloquea siempre: el historico se escribe una vez, al terminar
-- el job. Si algo salio mal, se corrige con una corrida nueva.
CREATE OR REPLACE FUNCTION fn_report_history_retencion()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'report_history es un registro historico: no se actualiza. Una generacion nueva inserta una fila nueva.';
    END IF;

    -- current_setting con el segundo argumento en true devuelve NULL en vez
    -- de reventar cuando la variable no esta definida, que es el caso normal.
    IF COALESCE(current_setting('app.retencion_reportes', true), '') <> 'on' THEN
        RAISE EXCEPTION
            'report_history no se borra automaticamente. Para aplicar la politica de retencion: SET LOCAL app.retencion_reportes = ''on'' dentro de la transaccion.';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_history_retencion ON report_history;
CREATE TRIGGER trg_report_history_retencion
    BEFORE UPDATE OR DELETE ON report_history
    FOR EACH ROW
    EXECUTE FUNCTION fn_report_history_retencion();

REVOKE TRUNCATE ON report_history FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Cola de notificaciones
-- ---------------------------------------------------------------------
-- Criterio tecnico 4: "si el envio falla, debo reintentar hasta un maximo de
-- 3 intentos con backoff exponencial antes de marcarlo como fallido
-- definitivamente".
--
-- Por que una tabla propia y no el event_outbox que ya existe: el bus
-- reintenta 5 veces, y ese numero es parte del contrato de las otras cuatro
-- historias. Cambiarlo a 3 para que encaje aca le cambiaria la politica de
-- reintentos a los puntos, los niveles y las recompensas. La cola de avisos
-- lleva su propio contador, y el bus sigue siendo quien transporta el evento
-- "el reporte quedo listo".
--
-- Una fila por destinatario y no una por reporte: si el correo de una persona
-- rebota, se reintenta el de esa persona, no el de las otras nueve.
CREATE TABLE IF NOT EXISTS report_notifications (
    id              BIGSERIAL PRIMARY KEY,

    history_id      BIGINT NOT NULL REFERENCES report_history(id),
    user_id         INT NOT NULL REFERENCES users(id),

    -- ready -> aviso a los roles suscritos (mensaje generico y enlace)
    -- error -> aviso al equipo tecnico (con el detalle tecnico)
    kind            VARCHAR(20) NOT NULL CHECK (kind IN ('ready', 'error')),

    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed')),

    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,

    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Criterio tecnico 2: "ni reenviar notificacion". Con esta restriccion,
    -- encolar dos veces el aviso del mismo reporte a la misma persona es
    -- imposible; el ON CONFLICT DO NOTHING del servicio se apoya en ella.
    UNIQUE (history_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_report_notifications_pendientes
    ON report_notifications (next_attempt_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- Programaciones iniciales
-- ---------------------------------------------------------------------
-- Dos ejemplos reales para que el panel no arranque vacio. Quedan ACTIVAS
-- pero con next_run_at en el proximo cambio de dia/mes, asi que no disparan
-- nada al aplicar la migracion.
--
-- Los ids se fijan a mano para que la migracion sea repetible (ON CONFLICT
-- necesita una clave), y despues se mueve la secuencia, igual que en 025.
INSERT INTO report_schedules
    (id, name, report_type, frequency, format, params, subscriber_roles, next_run_at)
VALUES
    (1, 'Desempeno semanal para RH', 'performance', 'weekly', 'csv',
     '{}'::jsonb, ARRAY['rh', 'admin']::text[],
     date_trunc('week', now()) + interval '1 week'),

    (2, 'Resultados organizacionales mensuales', 'organizational', 'monthly', 'csv',
     '{}'::jsonb, ARRAY['manager', 'admin']::text[],
     date_trunc('month', now()) + interval '1 month')
ON CONFLICT (id) DO NOTHING;

SELECT setval('report_schedules_id_seq', GREATEST((SELECT MAX(id) FROM report_schedules), 1));
