-- =====================================================================
-- 001_base.sql -- base de datos propia del servicio de reportes
--
-- Estructura de las tablas del servicio (reportes.*) tal como
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

CREATE OR REPLACE FUNCTION public.fn_report_history_retencion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_org_access_log_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
BEGIN
    RAISE EXCEPTION
        'org_report_access_log es una bitacora inmutable: la operacion % no esta permitida.', TG_OP;
END;
$function$;

CREATE SCHEMA IF NOT EXISTS reportes;

CREATE TABLE reportes.org_kpi_snapshots (
    id bigint NOT NULL,
    period character varying(20) NOT NULL,
    area_id integer,
    kpi_type character varying(40) NOT NULL,
    value numeric(12,2) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_kpi_snapshots_kpi_type_check CHECK (((kpi_type)::text = ANY ((ARRAY['participacion'::character varying, 'progreso_promedio'::character varying, 'cursos_completados'::character varying, 'engagement'::character varying])::text[])))
);

CREATE SEQUENCE reportes.org_kpi_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE reportes.org_kpi_snapshots_id_seq OWNED BY reportes.org_kpi_snapshots.id;

CREATE TABLE reportes.org_report_access_log (
    id bigint NOT NULL,
    requested_by integer NOT NULL,
    period character varying(20),
    compare_to character varying(20),
    area_id integer,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE reportes.org_report_access_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE reportes.org_report_access_log_id_seq OWNED BY reportes.org_report_access_log.id;

CREATE TABLE reportes.report_exports (
    id bigint NOT NULL,
    export_uid character varying(64) NOT NULL,
    requested_by integer NOT NULL,
    report_type character varying(50) NOT NULL,
    format character varying(10) NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    row_count integer,
    file_name character varying(120),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT report_exports_format_check CHECK (((format)::text = ANY ((ARRAY['csv'::character varying, 'pdf'::character varying])::text[]))),
    CONSTRAINT report_exports_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'ready'::character varying, 'failed'::character varying])::text[])))
);

CREATE SEQUENCE reportes.report_exports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE reportes.report_exports_id_seq OWNED BY reportes.report_exports.id;

CREATE TABLE reportes.report_history (
    id bigint NOT NULL,
    schedule_id bigint,
    type character varying(50) NOT NULL,
    period character varying(20) NOT NULL,
    params_used jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) NOT NULL,
    file_location character varying(255),
    row_count integer,
    error_summary text,
    log_reference character varying(80),
    duration_ms integer,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_history_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'error'::character varying])::text[])))
);

CREATE SEQUENCE reportes.report_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE reportes.report_history_id_seq OWNED BY reportes.report_history.id;

CREATE TABLE reportes.report_notifications (
    id bigint NOT NULL,
    history_id bigint NOT NULL,
    user_id integer NOT NULL,
    kind character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_notifications_kind_check CHECK (((kind)::text = ANY ((ARRAY['ready'::character varying, 'error'::character varying])::text[]))),
    CONSTRAINT report_notifications_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT report_notifications_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying])::text[])))
);

CREATE SEQUENCE reportes.report_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE reportes.report_notifications_id_seq OWNED BY reportes.report_notifications.id;

CREATE TABLE reportes.report_schedules (
    id bigint NOT NULL,
    name character varying(120) NOT NULL,
    report_type character varying(50) NOT NULL,
    frequency character varying(20) NOT NULL,
    format character varying(10) DEFAULT 'csv'::character varying NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    subscriber_roles text[] DEFAULT ARRAY['rh'::text] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    last_run_at timestamp with time zone,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_schedules_format_check CHECK (((format)::text = ANY ((ARRAY['csv'::character varying, 'pdf'::character varying])::text[]))),
    CONSTRAINT report_schedules_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying])::text[]))),
    CONSTRAINT report_schedules_report_type_check CHECK (((report_type)::text = ANY ((ARRAY['performance'::character varying, 'organizational'::character varying])::text[])))
);

CREATE SEQUENCE reportes.report_schedules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE reportes.report_schedules_id_seq OWNED BY reportes.report_schedules.id;

ALTER TABLE ONLY reportes.org_kpi_snapshots ALTER COLUMN id SET DEFAULT nextval('reportes.org_kpi_snapshots_id_seq'::regclass);

ALTER TABLE ONLY reportes.org_report_access_log ALTER COLUMN id SET DEFAULT nextval('reportes.org_report_access_log_id_seq'::regclass);

ALTER TABLE ONLY reportes.report_exports ALTER COLUMN id SET DEFAULT nextval('reportes.report_exports_id_seq'::regclass);

ALTER TABLE ONLY reportes.report_history ALTER COLUMN id SET DEFAULT nextval('reportes.report_history_id_seq'::regclass);

ALTER TABLE ONLY reportes.report_notifications ALTER COLUMN id SET DEFAULT nextval('reportes.report_notifications_id_seq'::regclass);

ALTER TABLE ONLY reportes.report_schedules ALTER COLUMN id SET DEFAULT nextval('reportes.report_schedules_id_seq'::regclass);

ALTER TABLE ONLY reportes.org_kpi_snapshots
    ADD CONSTRAINT org_kpi_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY reportes.org_report_access_log
    ADD CONSTRAINT org_report_access_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY reportes.report_exports
    ADD CONSTRAINT report_exports_export_uid_key UNIQUE (export_uid);

ALTER TABLE ONLY reportes.report_exports
    ADD CONSTRAINT report_exports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY reportes.report_history
    ADD CONSTRAINT report_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY reportes.report_notifications
    ADD CONSTRAINT report_notifications_history_id_user_id_key UNIQUE (history_id, user_id);

ALTER TABLE ONLY reportes.report_notifications
    ADD CONSTRAINT report_notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY reportes.report_schedules
    ADD CONSTRAINT report_schedules_pkey PRIMARY KEY (id);

CREATE INDEX idx_org_access_log_solicitante ON reportes.org_report_access_log USING btree (requested_by, requested_at DESC);

CREATE INDEX idx_org_kpi_snapshots_lectura ON reportes.org_kpi_snapshots USING btree (period, area_id, kpi_type, calculated_at DESC);

CREATE INDEX idx_org_kpi_snapshots_tendencia ON reportes.org_kpi_snapshots USING btree (kpi_type, area_id, period);

CREATE INDEX idx_report_exports_pendientes ON reportes.report_exports USING btree (created_at) WHERE ((status)::text = 'pending'::text);

CREATE INDEX idx_report_exports_solicitante ON reportes.report_exports USING btree (requested_by, created_at DESC);

CREATE UNIQUE INDEX idx_report_history_periodo_exitoso ON reportes.report_history USING btree (schedule_id, period) WHERE ((status)::text = 'success'::text);

CREATE INDEX idx_report_history_reciente ON reportes.report_history USING btree (generated_at DESC);

CREATE INDEX idx_report_notifications_pendientes ON reportes.report_notifications USING btree (next_attempt_at) WHERE ((status)::text = 'pending'::text);

CREATE INDEX idx_report_schedules_vencidas ON reportes.report_schedules USING btree (next_run_at) WHERE (is_active = true);

CREATE TRIGGER trg_org_access_log_inmutable BEFORE DELETE OR UPDATE ON reportes.org_report_access_log FOR EACH ROW EXECUTE FUNCTION public.fn_org_access_log_inmutable();

CREATE TRIGGER trg_report_history_retencion BEFORE DELETE OR UPDATE ON reportes.report_history FOR EACH ROW EXECUTE FUNCTION public.fn_report_history_retencion();

ALTER TABLE ONLY reportes.report_history
    ADD CONSTRAINT report_history_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES reportes.report_schedules(id);

ALTER TABLE ONLY reportes.report_notifications
    ADD CONSTRAINT report_notifications_history_id_fkey FOREIGN KEY (history_id) REFERENCES reportes.report_history(id);

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
