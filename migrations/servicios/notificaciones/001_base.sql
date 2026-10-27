-- =====================================================================
-- 001_base.sql -- base de datos propia del servicio de notificaciones
--
-- Estructura de las tablas del servicio (notificaciones.*) tal como
-- quedan despues de todo el historial de migrations/ (000 a 090). Es lo que
-- se aplica a la base propia del servicio cuando BASES_POR_SERVICIO=true.
--
-- - Solo estructura: los datos (incluidos los iniciales) los copia el runner
--   desde la base compartida la primera vez (compartido/config/migrate.js).
-- - No tiene llaves foraneas hacia tablas de otros servicios: esas tablas
--   viven en otra base. La integridad entre servicios la dan los contratos.
-- - Incluye su propia public.event_outbox: el servicio publica sus eventos
--   en la misma transaccion que sus datos (patron outbox).
--
-- Generado desde una base nueva migrada; no editar a mano. Los cambios
-- nuevos del servicio van en 002_..., 003_... de esta misma carpeta.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.email_templates_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
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
$function$;

CREATE SCHEMA IF NOT EXISTS notificaciones;

CREATE TABLE notificaciones.email_job_attempts (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    attempt_no integer NOT NULL,
    outcome character varying(20) NOT NULL,
    error_code character varying(50),
    error_detail text,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_job_attempts_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['sent'::character varying, 'transient_error'::character varying, 'permanent_error'::character varying])::text[])))
);

CREATE SEQUENCE notificaciones.email_job_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE notificaciones.email_job_attempts_id_seq OWNED BY notificaciones.email_job_attempts.id;

CREATE TABLE notificaciones.email_jobs (
    id bigint NOT NULL,
    user_id integer,
    notification_type character varying(50) NOT NULL,
    dedupe_key character varying(200) NOT NULL,
    notification_id bigint,
    to_email character varying(255),
    language character varying(5) NOT NULL,
    template_id bigint,
    template_version integer,
    subject character varying(255),
    body_html text,
    body_text text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    finished_at timestamp with time zone,
    CONSTRAINT email_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'sent'::character varying, 'failed'::character varying, 'undeliverable'::character varying, 'skipped'::character varying])::text[])))
);

CREATE SEQUENCE notificaciones.email_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE notificaciones.email_jobs_id_seq OWNED BY notificaciones.email_jobs.id;

CREATE TABLE notificaciones.email_notification_types (
    code character varying(50) NOT NULL,
    is_critical boolean DEFAULT false NOT NULL,
    description character varying(255) NOT NULL,
    user_configurable boolean DEFAULT true NOT NULL
);

CREATE TABLE notificaciones.email_preferences (
    user_id integer NOT NULL,
    notification_type character varying(50) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE notificaciones.email_templates (
    id bigint NOT NULL,
    notification_type character varying(50) NOT NULL,
    language character varying(5) NOT NULL,
    version integer NOT NULL,
    subject character varying(200) NOT NULL,
    body_html text NOT NULL,
    body_text text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_templates_language_check CHECK (((language)::text = ANY ((ARRAY['es'::character varying, 'en'::character varying])::text[]))),
    CONSTRAINT email_templates_version_check CHECK ((version > 0))
);

CREATE SEQUENCE notificaciones.email_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE notificaciones.email_templates_id_seq OWNED BY notificaciones.email_templates.id;

CREATE TABLE notificaciones.notification_deliveries (
    id bigint NOT NULL,
    notification_id bigint NOT NULL,
    channel character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'generada'::character varying NOT NULL,
    error text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    failed_at timestamp with time zone,
    read_at timestamp with time zone,
    CONSTRAINT notification_deliveries_channel_check CHECK (((channel)::text = ANY ((ARRAY['in_app'::character varying, 'email'::character varying])::text[]))),
    CONSTRAINT notification_deliveries_status_check CHECK (((status)::text = ANY ((ARRAY['generada'::character varying, 'entregada'::character varying, 'fallida'::character varying, 'leida'::character varying])::text[])))
);

CREATE SEQUENCE notificaciones.notification_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE notificaciones.notification_deliveries_id_seq OWNED BY notificaciones.notification_deliveries.id;

CREATE TABLE notificaciones.notification_preferences (
    user_id integer NOT NULL,
    channel character varying(20) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_preferences_channel_check CHECK (((channel)::text = ANY ((ARRAY['in_app'::character varying, 'email'::character varying])::text[])))
);

CREATE TABLE notificaciones.notifications (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    event_name character varying(50) NOT NULL,
    title character varying(150) NOT NULL,
    body text NOT NULL,
    payload jsonb,
    dedupe_key character varying(200) NOT NULL,
    email_status character varying(20) DEFAULT 'skipped'::character varying NOT NULL,
    email_error text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_email_status_check CHECK (((email_status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])))
);

CREATE SEQUENCE notificaciones.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE notificaciones.notifications_id_seq OWNED BY notificaciones.notifications.id;

ALTER TABLE ONLY notificaciones.email_job_attempts ALTER COLUMN id SET DEFAULT nextval('notificaciones.email_job_attempts_id_seq'::regclass);

ALTER TABLE ONLY notificaciones.email_jobs ALTER COLUMN id SET DEFAULT nextval('notificaciones.email_jobs_id_seq'::regclass);

ALTER TABLE ONLY notificaciones.email_templates ALTER COLUMN id SET DEFAULT nextval('notificaciones.email_templates_id_seq'::regclass);

ALTER TABLE ONLY notificaciones.notification_deliveries ALTER COLUMN id SET DEFAULT nextval('notificaciones.notification_deliveries_id_seq'::regclass);

ALTER TABLE ONLY notificaciones.notifications ALTER COLUMN id SET DEFAULT nextval('notificaciones.notifications_id_seq'::regclass);

ALTER TABLE ONLY notificaciones.email_job_attempts
    ADD CONSTRAINT email_job_attempts_job_id_attempt_no_key UNIQUE (job_id, attempt_no);

ALTER TABLE ONLY notificaciones.email_job_attempts
    ADD CONSTRAINT email_job_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY notificaciones.email_jobs
    ADD CONSTRAINT email_jobs_dedupe_key_key UNIQUE (dedupe_key);

ALTER TABLE ONLY notificaciones.email_jobs
    ADD CONSTRAINT email_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY notificaciones.email_notification_types
    ADD CONSTRAINT email_notification_types_pkey PRIMARY KEY (code);

ALTER TABLE ONLY notificaciones.email_preferences
    ADD CONSTRAINT email_preferences_pkey PRIMARY KEY (user_id, notification_type);

ALTER TABLE ONLY notificaciones.email_templates
    ADD CONSTRAINT email_templates_notification_type_language_version_key UNIQUE (notification_type, language, version);

ALTER TABLE ONLY notificaciones.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY notificaciones.notification_deliveries
    ADD CONSTRAINT notification_deliveries_notification_id_channel_key UNIQUE (notification_id, channel);

ALTER TABLE ONLY notificaciones.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY notificaciones.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id, channel);

ALTER TABLE ONLY notificaciones.notifications
    ADD CONSTRAINT notifications_dedupe_key_key UNIQUE (dedupe_key);

ALTER TABLE ONLY notificaciones.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

CREATE INDEX idx_email_job_attempts_job ON notificaciones.email_job_attempts USING btree (job_id);

CREATE INDEX idx_email_jobs_pendientes ON notificaciones.email_jobs USING btree (next_attempt_at) WHERE ((status)::text = 'pending'::text);

CREATE INDEX idx_email_jobs_usuario ON notificaciones.email_jobs USING btree (user_id, created_at DESC);

CREATE INDEX idx_notification_deliveries_aviso ON notificaciones.notification_deliveries USING btree (notification_id);

CREATE INDEX idx_notification_deliveries_fallidas ON notificaciones.notification_deliveries USING btree (failed_at DESC) WHERE ((status)::text = 'fallida'::text);

CREATE INDEX idx_notifications_no_leidas ON notificaciones.notifications USING btree (user_id) WHERE (read_at IS NULL);

CREATE INDEX idx_notifications_usuario ON notificaciones.notifications USING btree (user_id, created_at DESC);

CREATE UNIQUE INDEX uq_email_templates_activa ON notificaciones.email_templates USING btree (notification_type, language) WHERE is_active;

CREATE TRIGGER trg_email_templates_inmutable BEFORE DELETE OR UPDATE ON notificaciones.email_templates FOR EACH ROW EXECUTE FUNCTION public.email_templates_inmutable();

ALTER TABLE ONLY notificaciones.email_job_attempts
    ADD CONSTRAINT email_job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES notificaciones.email_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY notificaciones.email_jobs
    ADD CONSTRAINT email_jobs_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES notificaciones.notifications(id) ON DELETE SET NULL;

ALTER TABLE ONLY notificaciones.email_jobs
    ADD CONSTRAINT email_jobs_notification_type_fkey FOREIGN KEY (notification_type) REFERENCES notificaciones.email_notification_types(code);

ALTER TABLE ONLY notificaciones.email_jobs
    ADD CONSTRAINT email_jobs_template_id_fkey FOREIGN KEY (template_id) REFERENCES notificaciones.email_templates(id);

ALTER TABLE ONLY notificaciones.email_preferences
    ADD CONSTRAINT email_preferences_notification_type_fkey FOREIGN KEY (notification_type) REFERENCES notificaciones.email_notification_types(code);

ALTER TABLE ONLY notificaciones.email_templates
    ADD CONSTRAINT email_templates_notification_type_fkey FOREIGN KEY (notification_type) REFERENCES notificaciones.email_notification_types(code);

ALTER TABLE ONLY notificaciones.notification_deliveries
    ADD CONSTRAINT notification_deliveries_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES notificaciones.notifications(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.event_outbox (
    id bigint NOT NULL,
    event_name character varying(50) NOT NULL,
    payload jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT event_outbox_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'done'::character varying, 'failed'::character varying])::text[])))
);

CREATE SEQUENCE public.event_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.event_outbox_id_seq OWNED BY public.event_outbox.id;

ALTER TABLE ONLY public.event_outbox ALTER COLUMN id SET DEFAULT nextval('public.event_outbox_id_seq'::regclass);

ALTER TABLE ONLY public.event_outbox
    ADD CONSTRAINT event_outbox_pkey PRIMARY KEY (id);

CREATE INDEX idx_event_outbox_pendientes ON public.event_outbox USING btree (next_attempt_at, created_at) WHERE ((status)::text = 'pending'::text);
