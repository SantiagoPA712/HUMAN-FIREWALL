-- =====================================================================
-- 034_notificaciones_por_correo.sql
-- HU: "Yo como sistema quiero enviar notificaciones por correo electronico
-- de forma confiable ante eventos relevantes de la plataforma (asignacion de
-- curso, fecha limite proxima, resultado de evaluacion, etc.)".
--
-- Que agrega y por que:
--
--   users.language                -> idioma del correo (criterio de aceptacion 3)
--   course_assignments.due_date   -> sin fecha limite no hay "fecha limite proxima"
--   email_notification_types      -> catalogo de tipos, criticos vs opcionales (CT 5)
--   email_templates               -> plantillas versionadas por tipo e idioma (CT 2)
--   email_preferences             -> que tipos apago cada usuario (CA 2)
--   email_jobs                    -> la cola de envio, un job por correo (CT 1)
--   email_job_attempts            -> un registro por intento, con el error (CT 3)
--
-- Por que una cola propia y no el event_outbox:
--   El outbox reintenta el EVENTO entero (5 veces, 2-16 s) y corre todos sus
--   handlers. El correo necesita su propia politica: 3 reintentos, backoff en
--   la escala de un proveedor caido (decenas de segundos), un estado
--   'undeliverable' que no se reintenta, y un rastro por intento. Mezclarlo
--   haria que un SMTP caido reprocesara puntos, niveles y recompensas.
--
-- Depende de: schema.sql (users, course_assignments),
--             009_notificaciones.sql (notifications)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Idioma de la cuenta (criterio de aceptacion 3)
-- ---------------------------------------------------------------------
-- NULL significa "no configurado": el correo sale en el idioma por defecto de
-- la plataforma (DEFAULT_LANGUAGE, 'es' si no se define). Se deja NULL y no
-- 'es' a proposito: asi, si la plataforma cambia su idioma por defecto, lo
-- siguen quienes nunca eligieron uno, y no quienes eligieron espanol.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS language VARCHAR(5);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_language_valido'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_language_valido
            CHECK (language IS NULL OR language IN ('es', 'en'));
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- Fecha limite de una asignacion
-- ---------------------------------------------------------------------
-- deadline_notified_at: cuando se aviso que vencia. El scanner lo marca en la
-- MISMA transaccion en que publica el evento, asi que una asignacion avisa
-- una sola vez aunque el scanner corra cada pocos minutos.
ALTER TABLE course_assignments
    ADD COLUMN IF NOT EXISTS assigned_at          TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS due_date             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_notified_at TIMESTAMPTZ;

-- La consulta del scanner: asignaciones abiertas, con fecha, sin avisar.
CREATE INDEX IF NOT EXISTS idx_course_assignments_vencimientos
    ON course_assignments (due_date)
    WHERE due_date IS NOT NULL AND deadline_notified_at IS NULL;

-- ---------------------------------------------------------------------
-- Tipos de notificacion por correo (criterio tecnico 5)
-- ---------------------------------------------------------------------
-- "Debo distinguir en configuracion las notificaciones criticas (no
-- desactivables) de las opcionales". La marca vive en la base y no en el
-- codigo para que se pueda ver y auditar con un SELECT.
CREATE TABLE IF NOT EXISTS email_notification_types (
    code        VARCHAR(50) PRIMARY KEY,
    is_critical BOOLEAN NOT NULL DEFAULT false,
    description VARCHAR(255) NOT NULL
);

INSERT INTO email_notification_types (code, is_critical, description) VALUES
    ('course_assigned',           false, 'Te asignaron un curso nuevo'),
    ('deadline_approaching',      false, 'Se acerca la fecha limite de un curso asignado'),
    ('evaluation_result',         false, 'Resultado de una evaluacion, simulacion o curso'),
    ('critical_course_alert',     false, 'Alerta de RH: resultado de un curso critico de tu equipo'),
    ('security_password_changed', true,  'Se cambio la contrasena de tu cuenta')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Plantillas versionadas (criterio tecnico 2)
-- ---------------------------------------------------------------------
-- Una plantilla se identifica por (tipo, idioma, version). Solo una version
-- por (tipo, idioma) esta activa, y cada job guarda con que version se armo:
-- asi se puede responder "que texto exacto recibio esta persona" aunque la
-- plantilla haya cambiado despues.
--
-- Para cambiar un texto NO se edita la fila: se inserta la version siguiente
-- y se desactiva la anterior, en una migracion nueva. El trigger de mas abajo
-- lo hace cumplir.
--
-- Sintaxis: {{variable}} se reemplaza (escapada en HTML), y
-- {{#variable}}...{{/variable}} / {{^variable}}...{{/variable}} muestran el
-- bloque si la variable esta / no esta presente (el 0 cuenta como presente).
CREATE TABLE IF NOT EXISTS email_templates (
    id                BIGSERIAL PRIMARY KEY,
    notification_type VARCHAR(50) NOT NULL REFERENCES email_notification_types(code),
    language          VARCHAR(5)  NOT NULL CHECK (language IN ('es', 'en')),
    version           INT         NOT NULL CHECK (version > 0),
    subject           VARCHAR(200) NOT NULL,
    body_html         TEXT NOT NULL,
    body_text         TEXT NOT NULL,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (notification_type, language, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_templates_activa
    ON email_templates (notification_type, language) WHERE is_active;

-- Una version publicada no se reescribe: solo se puede activar o desactivar.
CREATE OR REPLACE FUNCTION email_templates_inmutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'email_templates: una version publicada no se borra, se desactiva';
    END IF;

    IF NEW.notification_type IS DISTINCT FROM OLD.notification_type
       OR NEW.language  IS DISTINCT FROM OLD.language
       OR NEW.version   IS DISTINCT FROM OLD.version
       OR NEW.subject   IS DISTINCT FROM OLD.subject
       OR NEW.body_html IS DISTINCT FROM OLD.body_html
       OR NEW.body_text IS DISTINCT FROM OLD.body_text THEN
        RAISE EXCEPTION 'email_templates: el contenido de una version no se edita; publica la version %', OLD.version + 1;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_templates_inmutable ON email_templates;
CREATE TRIGGER trg_email_templates_inmutable
    BEFORE UPDATE OR DELETE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION email_templates_inmutable();

-- Version 1 de cada plantilla, en espanol e ingles.
INSERT INTO email_templates (notification_type, language, version, subject, body_html, body_text) VALUES

('course_assigned', 'es', 1,
 'Nuevo curso asignado: {{curso}}',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#1d4ed8">Tenes un curso nuevo</h2>
<p>Hola {{nombre}}, te asignaron el curso <strong>{{curso}}</strong>.</p>
{{#fechaLimite}}<p>Fecha limite: <strong>{{fechaLimite}}</strong>.</p>{{/fechaLimite}}
<p><a href="{{enlace}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Ir al curso</a></p>
<p style="font-size:12px;color:#6b7280">Podes elegir que correos recibir desde tu centro de notificaciones.</p>
</div>$h$,
 $t$Hola {{nombre}}, te asignaron el curso "{{curso}}".
{{#fechaLimite}}Fecha limite: {{fechaLimite}}.
{{/fechaLimite}}Ir al curso: {{enlace}}$t$),

('course_assigned', 'en', 1,
 'New course assigned: {{curso}}',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#1d4ed8">You have a new course</h2>
<p>Hi {{nombre}}, you were assigned the course <strong>{{curso}}</strong>.</p>
{{#fechaLimite}}<p>Due date: <strong>{{fechaLimite}}</strong>.</p>{{/fechaLimite}}
<p><a href="{{enlace}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Go to the course</a></p>
<p style="font-size:12px;color:#6b7280">You can choose which emails you receive from your notification center.</p>
</div>$h$,
 $t$Hi {{nombre}}, you were assigned the course "{{curso}}".
{{#fechaLimite}}Due date: {{fechaLimite}}.
{{/fechaLimite}}Go to the course: {{enlace}}$t$),

('deadline_approaching', 'es', 1,
 'Se acerca la fecha limite de {{curso}}',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#b45309">Tu curso vence pronto</h2>
<p>Hola {{nombre}}, el curso <strong>{{curso}}</strong> vence el <strong>{{fechaLimite}}</strong>.</p>
<p>Todavia estas a tiempo de terminarlo.</p>
<p><a href="{{enlace}}" style="background:#b45309;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Continuar el curso</a></p>
</div>$h$,
 $t$Hola {{nombre}}, el curso "{{curso}}" vence el {{fechaLimite}}.
Todavia estas a tiempo de terminarlo: {{enlace}}$t$),

('deadline_approaching', 'en', 1,
 'Due date approaching for {{curso}}',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#b45309">Your course is due soon</h2>
<p>Hi {{nombre}}, the course <strong>{{curso}}</strong> is due on <strong>{{fechaLimite}}</strong>.</p>
<p>There is still time to finish it.</p>
<p><a href="{{enlace}}" style="background:#b45309;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Continue the course</a></p>
</div>$h$,
 $t$Hi {{nombre}}, the course "{{curso}}" is due on {{fechaLimite}}.
There is still time to finish it: {{enlace}}$t$),

('evaluation_result', 'es', 1,
 '{{#aprobado}}Aprobaste{{/aprobado}}{{^aprobado}}No superaste{{/aprobado}}: {{evaluacion}}',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
{{#aprobado}}<h2 style="color:#15803d">Aprobaste {{evaluacion}}</h2>{{/aprobado}}
{{^aprobado}}<h2 style="color:#b91c1c">No superaste {{evaluacion}}</h2>{{/aprobado}}
<p>Hola {{nombre}}{{#puntaje}}, tu puntaje fue <strong>{{puntaje}}</strong>{{/puntaje}}.</p>
{{^aprobado}}<p>Podes reforzar el tema y volver a intentarlo cuando quieras.</p>{{/aprobado}}
<p><a href="{{enlace}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">{{#aprobado}}Ver mi desempeno{{/aprobado}}{{^aprobado}}Volver a intentarlo{{/aprobado}}</a></p>
</div>$h$,
 $t${{#aprobado}}Aprobaste{{/aprobado}}{{^aprobado}}No superaste{{/aprobado}} "{{evaluacion}}"{{#puntaje}} con un puntaje de {{puntaje}}{{/puntaje}}.
{{^aprobado}}Podes reforzar el tema y volver a intentarlo cuando quieras.
{{/aprobado}}{{enlace}}$t$),

('evaluation_result', 'en', 1,
 '{{#aprobado}}You passed{{/aprobado}}{{^aprobado}}You did not pass{{/aprobado}}: {{evaluacion}}',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
{{#aprobado}}<h2 style="color:#15803d">You passed {{evaluacion}}</h2>{{/aprobado}}
{{^aprobado}}<h2 style="color:#b91c1c">You did not pass {{evaluacion}}</h2>{{/aprobado}}
<p>Hi {{nombre}}{{#puntaje}}, your score was <strong>{{puntaje}}</strong>{{/puntaje}}.</p>
{{^aprobado}}<p>You can review the topic and try again whenever you want.</p>{{/aprobado}}
<p><a href="{{enlace}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">{{#aprobado}}See my performance{{/aprobado}}{{^aprobado}}Try again{{/aprobado}}</a></p>
</div>$h$,
 $t${{#aprobado}}You passed{{/aprobado}}{{^aprobado}}You did not pass{{/aprobado}} "{{evaluacion}}"{{#puntaje}} with a score of {{puntaje}}{{/puntaje}}.
{{^aprobado}}You can review the topic and try again whenever you want.
{{/aprobado}}{{enlace}}$t$),

('critical_course_alert', 'es', 1,
 'Curso critico: {{empleado}} {{#aprobado}}completo{{/aprobado}}{{^aprobado}}no supero{{/aprobado}} "{{curso}}"',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#b45309">Resultado en un curso critico</h2>
<p><strong>{{empleado}}</strong> {{#aprobado}}completo{{/aprobado}}{{^aprobado}}no supero{{/aprobado}} contenido del curso critico <strong>{{curso}}</strong>{{#puntaje}} (puntaje: {{puntaje}}){{/puntaje}}.</p>
<p><a href="{{enlace}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Ver el reporte de desempeno</a></p>
</div>$h$,
 $t${{empleado}} {{#aprobado}}completo{{/aprobado}}{{^aprobado}}no supero{{/aprobado}} contenido del curso critico "{{curso}}"{{#puntaje}} (puntaje: {{puntaje}}){{/puntaje}}.
Reporte de desempeno: {{enlace}}$t$),

('critical_course_alert', 'en', 1,
 'Critical course: {{empleado}} {{#aprobado}}completed{{/aprobado}}{{^aprobado}}did not pass{{/aprobado}} "{{curso}}"',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#b45309">Result in a critical course</h2>
<p><strong>{{empleado}}</strong> {{#aprobado}}completed{{/aprobado}}{{^aprobado}}did not pass{{/aprobado}} content from the critical course <strong>{{curso}}</strong>{{#puntaje}} (score: {{puntaje}}){{/puntaje}}.</p>
<p><a href="{{enlace}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open the performance report</a></p>
</div>$h$,
 $t${{empleado}} {{#aprobado}}completed{{/aprobado}}{{^aprobado}}did not pass{{/aprobado}} content from the critical course "{{curso}}"{{#puntaje}} (score: {{puntaje}}){{/puntaje}}.
Performance report: {{enlace}}$t$),

('security_password_changed', 'es', 1,
 'Se cambio la contrasena de tu cuenta',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#b91c1c">Tu contrasena cambio</h2>
<p>Hola {{nombre}}, la contrasena de tu cuenta de Human Firewall se cambio el <strong>{{fecha}}</strong>.</p>
<p>Si fuiste vos, no tenes que hacer nada. <strong>Si no fuiste vos</strong>, recupera tu cuenta ahora:</p>
<p><a href="{{enlace}}" style="background:#b91c1c;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Recuperar mi cuenta</a></p>
<p style="font-size:12px;color:#6b7280">Este es un aviso de seguridad y no se puede desactivar.</p>
</div>$h$,
 $t$Hola {{nombre}}, la contrasena de tu cuenta de Human Firewall se cambio el {{fecha}}.
Si no fuiste vos, recupera tu cuenta ahora: {{enlace}}
Este es un aviso de seguridad y no se puede desactivar.$t$),

('security_password_changed', 'en', 1,
 'Your account password was changed',
 $h$<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#b91c1c">Your password changed</h2>
<p>Hi {{nombre}}, the password of your Human Firewall account was changed on <strong>{{fecha}}</strong>.</p>
<p>If it was you, there is nothing to do. <strong>If it was not you</strong>, recover your account now:</p>
<p><a href="{{enlace}}" style="background:#b91c1c;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Recover my account</a></p>
<p style="font-size:12px;color:#6b7280">This is a security notice and cannot be turned off.</p>
</div>$h$,
 $t$Hi {{nombre}}, the password of your Human Firewall account was changed on {{fecha}}.
If it was not you, recover your account now: {{enlace}}
This is a security notice and cannot be turned off.$t$)

ON CONFLICT (notification_type, language, version) DO NOTHING;

-- ---------------------------------------------------------------------
-- Preferencias por tipo (criterio de aceptacion 2)
-- ---------------------------------------------------------------------
-- Igual que notification_preferences (033): sin fila, el tipo esta
-- habilitado. Solo se escribe lo que alguien cambio.
--
-- No es la misma tabla porque responde otra pregunta. La de la 033 es "por
-- que CANAL" (in_app / email); esta es "que TIPOS de correo". Las dos se
-- respetan: el canal email apagado corta todo correo opcional, y un tipo
-- apagado corta solo ese tipo. Los criticos ignoran ambas.
CREATE TABLE IF NOT EXISTS email_preferences (
    user_id           INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL REFERENCES email_notification_types(code),
    enabled           BOOLEAN NOT NULL DEFAULT true,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, notification_type)
);

-- ---------------------------------------------------------------------
-- Cola de envio (criterios tecnicos 1, 3 y 4)
-- ---------------------------------------------------------------------
-- Un job por correo. Se inserta desde el handler del evento y lo procesa un
-- worker aparte: la operacion que origino el evento ya respondio hace rato.
--
-- El contenido se renderiza al ENCOLAR y queda guardado. Los reintentos
-- mandan exactamente el mismo correo, aunque en el medio se publique una
-- version nueva de la plantilla.
CREATE TABLE IF NOT EXISTS email_jobs (
    id                BIGSERIAL PRIMARY KEY,
    user_id           INT REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL REFERENCES email_notification_types(code),

    -- Identifica el HECHO, no el intento: el bus reprocesa eventos y no puede
    -- salir un segundo correo por eso.
    dedupe_key        VARCHAR(200) NOT NULL UNIQUE,

    -- Aviso de la bandeja al que corresponde este correo, si lo hay. Lo usa
    -- la HU de resultados para reflejar la entrega por canal.
    notification_id   BIGINT REFERENCES notifications(id) ON DELETE SET NULL,

    to_email          VARCHAR(255),
    language          VARCHAR(5) NOT NULL,
    template_id       BIGINT REFERENCES email_templates(id),
    template_version  INT,
    subject           VARCHAR(255),
    body_html         TEXT,
    body_text         TEXT,

    -- pending        -> esperando turno (o esperando el proximo reintento)
    -- processing     -> un worker lo tomo
    -- sent           -> el proveedor lo acepto
    -- failed         -> agoto los reintentos, o el error no era transitorio
    -- undeliverable  -> no habia direccion valida: se descarta sin reintentar
    -- skipped        -> no hay SMTP configurado (modo por defecto en desarrollo)
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','processing','sent','failed','undeliverable','skipped')),

    attempts          INT NOT NULL DEFAULT 0,
    -- Intentos de envio permitidos en total, contando el primero.
    max_attempts      INT NOT NULL,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error        TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at           TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ
);

-- Lo unico que consulta el worker.
CREATE INDEX IF NOT EXISTS idx_email_jobs_pendientes
    ON email_jobs (next_attempt_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_email_jobs_usuario
    ON email_jobs (user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Intentos (criterio tecnico 3)
-- ---------------------------------------------------------------------
-- "Debo registrar cada intento fallido en los logs con el detalle tecnico del
-- error". Ademas de la linea en la consola, queda una fila por intento: el
-- job solo guarda el ULTIMO error, y para soporte importa la secuencia.
CREATE TABLE IF NOT EXISTS email_job_attempts (
    id           BIGSERIAL PRIMARY KEY,
    job_id       BIGINT NOT NULL REFERENCES email_jobs(id) ON DELETE CASCADE,
    attempt_no   INT NOT NULL,
    outcome      VARCHAR(20) NOT NULL CHECK (outcome IN ('sent', 'transient_error', 'permanent_error')),
    error_code   VARCHAR(50),
    error_detail TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (job_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_email_job_attempts_job
    ON email_job_attempts (job_id);
