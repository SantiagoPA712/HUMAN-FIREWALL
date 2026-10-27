-- =====================================================================
-- 001_base.sql -- base de datos propia del servicio de seguridad
--
-- Estructura de las tablas del servicio (seguridad.*, data.*) tal como
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

CREATE OR REPLACE FUNCTION public.fn_anomaly_events_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'anomaly_events es un registro de auditoria: no se puede eliminar. Para cerrar una alerta se cambia su status a reviewed o dismissed.';
    END IF;

    -- UPDATE: se compara fila contra fila ignorando el status. Si lo demas
    -- quedo igual, el cambio es legitimo.
    IF (NEW.id, NEW.user_id, NEW.rule_triggered, NEW.evidence, NEW.severity,
        NEW.source_id, NEW.dedupe_key, NEW.detected_at)
       IS DISTINCT FROM
       (OLD.id, OLD.user_id, OLD.rule_triggered, OLD.evidence, OLD.severity,
        OLD.source_id, OLD.dedupe_key, OLD.detected_at)
    THEN
        RAISE EXCEPTION
            'anomaly_events solo admite cambios en la columna status. La evidencia de una alerta no se reescribe.';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_anomaly_status_history_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
BEGIN
    RAISE EXCEPTION
        'anomaly_status_history es un historial inmutable: la operacion % no esta permitida.', TG_OP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_log_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
BEGIN
    RAISE EXCEPTION
        'audit_log es un registro inmutable: la operacion % no esta permitida. Un error se corrige con una entrada nueva, no reescribiendo la anterior.',
        TG_OP;
END;
$function$;

CREATE SCHEMA IF NOT EXISTS data;

CREATE SCHEMA IF NOT EXISTS seguridad;

CREATE FUNCTION data.fn_logs_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
    AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'data.logs es un registro inmutable: no se actualiza. Un error se corrige registrando una accion nueva.';
    END IF;

    -- current_setting(..., true) devuelve NULL en vez de fallar cuando la
    -- variable no existe, que es el caso normal.
    IF COALESCE(current_setting('app.retencion_logs', true), '') <> 'on' THEN
        RAISE EXCEPTION
            'data.logs no admite borrados manuales. Solo la politica de retencion automatica puede eliminar registros.';
    END IF;

    RETURN OLD;
END;
$$;

CREATE FUNCTION data.fn_logs_purges_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
    AS $$
BEGIN
    RAISE EXCEPTION
        'data.logs_purges es la evidencia de las purgas: la operacion % no esta permitida.', TG_OP;
END;
$$;

CREATE FUNCTION data.fn_logs_sin_truncate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
    AS $$
BEGIN
    RAISE EXCEPTION 'data.logs no se puede vaciar con TRUNCATE.';
END;
$$;

CREATE TABLE data.logs (
    id bigint NOT NULL,
    log_uid uuid NOT NULL,
    user_id integer,
    actor_type character varying(10) DEFAULT 'user'::character varying NOT NULL,
    actor_email character varying(255),
    action_type character varying(40) NOT NULL,
    module character varying(40) NOT NULL,
    resource_type character varying(40) NOT NULL,
    resource_id character varying(100),
    old_value jsonb,
    new_value jsonb,
    ip_address character varying(64),
    trace_id character varying(64),
    occurred_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_logs_actor_sistema CHECK ((((actor_type)::text = 'user'::text) OR (user_id IS NULL))),
    CONSTRAINT logs_actor_type_check CHECK (((actor_type)::text = ANY ((ARRAY['user'::character varying, 'system'::character varying])::text[])))
);

CREATE SEQUENCE data.logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE data.logs_id_seq OWNED BY data.logs.id;

CREATE TABLE data.logs_purges (
    id bigint NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    retention_months integer NOT NULL,
    cutoff timestamp with time zone NOT NULL,
    deleted_count integer NOT NULL,
    oldest_deleted timestamp with time zone,
    newest_deleted timestamp with time zone,
    trace_id character varying(64),
    CONSTRAINT logs_purges_deleted_count_check CHECK ((deleted_count >= 0)),
    CONSTRAINT logs_purges_retention_months_check CHECK ((retention_months > 0))
);

CREATE SEQUENCE data.logs_purges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE data.logs_purges_id_seq OWNED BY data.logs_purges.id;

CREATE TABLE seguridad.activity_logs (
    id integer NOT NULL,
    user_id integer,
    action character varying(100) NOT NULL,
    description text,
    ip_address character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE seguridad.activity_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE seguridad.activity_logs_id_seq OWNED BY seguridad.activity_logs.id;

CREATE TABLE seguridad.anomaly_events (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    rule_triggered character varying(50) NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    severity character varying(10) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    source_id character varying(50),
    dedupe_key character varying(120) NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT anomaly_events_severity_check CHECK (((severity)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[]))),
    CONSTRAINT anomaly_events_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'reviewed'::character varying, 'dismissed'::character varying])::text[])))
);

CREATE SEQUENCE seguridad.anomaly_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE seguridad.anomaly_events_id_seq OWNED BY seguridad.anomaly_events.id;

CREATE TABLE seguridad.anomaly_rules (
    code character varying(50) NOT NULL,
    description text,
    rule_type character varying(30) DEFAULT 'points_rate'::character varying NOT NULL,
    window_minutes integer NOT NULL,
    max_points integer NOT NULL,
    severity character varying(10) DEFAULT 'medium'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT anomaly_rules_max_points_check CHECK ((max_points > 0)),
    CONSTRAINT anomaly_rules_rule_type_check CHECK (((rule_type)::text = 'points_rate'::text)),
    CONSTRAINT anomaly_rules_severity_check CHECK (((severity)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[]))),
    CONSTRAINT anomaly_rules_window_minutes_check CHECK ((window_minutes > 0))
);

CREATE TABLE seguridad.anomaly_status_history (
    id bigint NOT NULL,
    anomaly_id bigint NOT NULL,
    previous_status character varying(20) NOT NULL,
    new_status character varying(20) NOT NULL,
    changed_by integer NOT NULL,
    note text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT anomaly_status_history_new_status_check CHECK (((new_status)::text = ANY ((ARRAY['pending'::character varying, 'reviewed'::character varying, 'dismissed'::character varying])::text[])))
);

CREATE SEQUENCE seguridad.anomaly_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE seguridad.anomaly_status_history_id_seq OWNED BY seguridad.anomaly_status_history.id;

CREATE TABLE seguridad.audit_log (
    id bigint NOT NULL,
    actor_id integer NOT NULL,
    target_user_id integer,
    change_type character varying(30) NOT NULL,
    previous_value jsonb,
    new_value jsonb,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_change_type_check CHECK (((change_type)::text = ANY ((ARRAY['points'::character varying, 'level'::character varying, 'badge'::character varying, 'anomaly_status'::character varying])::text[]))),
    CONSTRAINT audit_log_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0))
);

CREATE SEQUENCE seguridad.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE seguridad.audit_log_id_seq OWNED BY seguridad.audit_log.id;

ALTER TABLE ONLY data.logs ALTER COLUMN id SET DEFAULT nextval('data.logs_id_seq'::regclass);

ALTER TABLE ONLY data.logs_purges ALTER COLUMN id SET DEFAULT nextval('data.logs_purges_id_seq'::regclass);

ALTER TABLE ONLY seguridad.activity_logs ALTER COLUMN id SET DEFAULT nextval('seguridad.activity_logs_id_seq'::regclass);

ALTER TABLE ONLY seguridad.anomaly_events ALTER COLUMN id SET DEFAULT nextval('seguridad.anomaly_events_id_seq'::regclass);

ALTER TABLE ONLY seguridad.anomaly_status_history ALTER COLUMN id SET DEFAULT nextval('seguridad.anomaly_status_history_id_seq'::regclass);

ALTER TABLE ONLY seguridad.audit_log ALTER COLUMN id SET DEFAULT nextval('seguridad.audit_log_id_seq'::regclass);

ALTER TABLE ONLY data.logs
    ADD CONSTRAINT logs_log_uid_key UNIQUE (log_uid);

ALTER TABLE ONLY data.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY data.logs_purges
    ADD CONSTRAINT logs_purges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY seguridad.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY seguridad.anomaly_events
    ADD CONSTRAINT anomaly_events_dedupe_key_key UNIQUE (dedupe_key);

ALTER TABLE ONLY seguridad.anomaly_events
    ADD CONSTRAINT anomaly_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY seguridad.anomaly_rules
    ADD CONSTRAINT anomaly_rules_pkey PRIMARY KEY (code);

ALTER TABLE ONLY seguridad.anomaly_status_history
    ADD CONSTRAINT anomaly_status_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY seguridad.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

CREATE INDEX idx_logs_action_type ON data.logs USING btree (action_type, occurred_at DESC);

CREATE INDEX idx_logs_module ON data.logs USING btree (module, occurred_at DESC);

CREATE INDEX idx_logs_occurred_at ON data.logs USING btree (occurred_at DESC, id DESC);

CREATE INDEX idx_logs_purges_fecha ON data.logs_purges USING btree (executed_at DESC);

CREATE INDEX idx_logs_resource_type ON data.logs USING btree (resource_type, occurred_at DESC);

CREATE INDEX idx_logs_user ON data.logs USING btree (user_id, occurred_at DESC);

CREATE INDEX idx_anomaly_events_pendientes ON seguridad.anomaly_events USING btree (detected_at DESC) WHERE ((status)::text = 'pending'::text);

CREATE INDEX idx_anomaly_events_usuario ON seguridad.anomaly_events USING btree (user_id, detected_at DESC);

CREATE INDEX idx_anomaly_status_history_alerta ON seguridad.anomaly_status_history USING btree (anomaly_id, changed_at DESC);

CREATE INDEX idx_audit_log_actor ON seguridad.audit_log USING btree (actor_id, created_at DESC);

CREATE INDEX idx_audit_log_objetivo ON seguridad.audit_log USING btree (target_user_id, created_at DESC);

CREATE INDEX idx_audit_log_tipo ON seguridad.audit_log USING btree (change_type, created_at DESC);

CREATE TRIGGER trg_logs_inmutable BEFORE DELETE OR UPDATE ON data.logs FOR EACH ROW EXECUTE FUNCTION data.fn_logs_inmutable();

CREATE TRIGGER trg_logs_purges_inmutable BEFORE DELETE OR UPDATE ON data.logs_purges FOR EACH ROW EXECUTE FUNCTION data.fn_logs_purges_inmutable();

CREATE TRIGGER trg_logs_sin_truncate BEFORE TRUNCATE ON data.logs FOR EACH STATEMENT EXECUTE FUNCTION data.fn_logs_sin_truncate();

CREATE TRIGGER trg_anomaly_events_inmutable BEFORE DELETE OR UPDATE ON seguridad.anomaly_events FOR EACH ROW EXECUTE FUNCTION public.fn_anomaly_events_inmutable();

CREATE TRIGGER trg_anomaly_status_history_inmutable BEFORE DELETE OR UPDATE ON seguridad.anomaly_status_history FOR EACH ROW EXECUTE FUNCTION public.fn_anomaly_status_history_inmutable();

CREATE TRIGGER trg_audit_log_inmutable BEFORE DELETE OR UPDATE ON seguridad.audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_inmutable();

ALTER TABLE ONLY seguridad.anomaly_status_history
    ADD CONSTRAINT anomaly_status_history_anomaly_id_fkey FOREIGN KEY (anomaly_id) REFERENCES seguridad.anomaly_events(id);

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
