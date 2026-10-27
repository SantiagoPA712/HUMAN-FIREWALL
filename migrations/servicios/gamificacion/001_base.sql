-- =====================================================================
-- 001_base.sql -- base de datos propia del servicio de gamificacion
--
-- Estructura de las tablas del servicio (gamificacion.*) tal como
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

CREATE OR REPLACE FUNCTION public.fn_points_ledger_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
BEGIN
    RAISE EXCEPTION
        'points_ledger es un historial inmutable: la operacion % no esta permitida. Para corregir un movimiento, insertar uno compensatorio con points negativo.',
        TG_OP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_user_rewards_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
BEGIN
    RAISE EXCEPTION
        'user_rewards es un historial inmutable: la operacion % no esta permitida. Editar o eliminar una recompensa del catalogo no debe afectar lo ya otorgado.',
        TG_OP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_user_level_history_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
BEGIN
    RAISE EXCEPTION
        'user_level_history es un historial inmutable: la operacion % no esta permitida. Cambiar los umbrales de levels_config no debe reescribir los niveles ya alcanzados.',
        TG_OP;
END;
$function$;

CREATE SCHEMA IF NOT EXISTS gamificacion;

CREATE TABLE gamificacion.rewards_catalog (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    points_required integer DEFAULT 0,
    icon_url character varying(255),
    condition_type character varying(30) DEFAULT 'points_total'::character varying NOT NULL,
    condition_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_repeatable boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_rewards_condition_type CHECK (((condition_type)::text = ANY ((ARRAY['points_total'::character varying, 'courses_completed'::character varying, 'lessons_completed'::character varying, 'quizzes_approved'::character varying, 'quiz_streak'::character varying])::text[])))
);

CREATE SEQUENCE gamificacion.badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE gamificacion.badges_id_seq OWNED BY gamificacion.rewards_catalog.id;

CREATE TABLE gamificacion.levels_config (
    level integer NOT NULL,
    name character varying(50) NOT NULL,
    description text,
    icon_url character varying(255),
    min_points integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT levels_config_level_check CHECK ((level > 0)),
    CONSTRAINT levels_config_min_points_check CHECK ((min_points >= 0))
);

CREATE TABLE gamificacion.points_ledger (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    source_type character varying(20) NOT NULL,
    source_id character varying(50),
    points integer NOT NULL,
    rule_code character varying(50),
    idempotency_key character varying(200) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT points_ledger_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['lesson'::character varying, 'quiz'::character varying, 'course'::character varying, 'challenge'::character varying, 'simulation'::character varying, 'manual'::character varying])::text[])))
);

CREATE SEQUENCE gamificacion.points_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE gamificacion.points_ledger_id_seq OWNED BY gamificacion.points_ledger.id;

CREATE TABLE gamificacion.points_rules (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    source_type character varying(20) NOT NULL,
    points_mode character varying(20) DEFAULT 'fixed'::character varying NOT NULL,
    points integer NOT NULL,
    allow_repeat boolean DEFAULT false NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT points_rules_points_check CHECK ((points >= 0)),
    CONSTRAINT points_rules_points_mode_check CHECK (((points_mode)::text = ANY ((ARRAY['fixed'::character varying, 'by_score'::character varying])::text[]))),
    CONSTRAINT points_rules_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['lesson'::character varying, 'quiz'::character varying, 'course'::character varying, 'challenge'::character varying, 'simulation'::character varying, 'manual'::character varying])::text[])))
);

CREATE SEQUENCE gamificacion.points_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE gamificacion.points_rules_id_seq OWNED BY gamificacion.points_rules.id;

CREATE TABLE gamificacion.recommendation_rules (
    code character varying(50) NOT NULL,
    description text,
    score_threshold integer DEFAULT 70 NOT NULL,
    include_failed boolean DEFAULT true NOT NULL,
    max_suggestions integer DEFAULT 5 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recommendation_rules_max_suggestions_check CHECK ((max_suggestions > 0)),
    CONSTRAINT recommendation_rules_score_threshold_check CHECK (((score_threshold >= 0) AND (score_threshold <= 100)))
);

CREATE TABLE gamificacion.user_rewards (
    id integer NOT NULL,
    user_id integer,
    reward_id integer,
    earned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reward_name character varying(100) NOT NULL,
    reward_description text,
    reward_icon_url character varying(255),
    source_type character varying(30),
    source_id character varying(50),
    condition_snapshot jsonb,
    dedupe_key character varying(200) NOT NULL
);

CREATE SEQUENCE gamificacion.user_badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE gamificacion.user_badges_id_seq OWNED BY gamificacion.user_rewards.id;

CREATE TABLE gamificacion.user_level_history (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    level integer NOT NULL,
    level_name character varying(50),
    min_points integer,
    points_at integer NOT NULL,
    reached_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_level_history_level_check CHECK ((level > 0))
);

CREATE SEQUENCE gamificacion.user_level_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE gamificacion.user_level_history_id_seq OWNED BY gamificacion.user_level_history.id;

CREATE TABLE gamificacion.user_recommendations (
    user_id integer NOT NULL,
    trigger_event character varying(50),
    areas jsonb DEFAULT '[]'::jsonb NOT NULL,
    recomendaciones jsonb DEFAULT '[]'::jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE VIEW gamificacion.v_user_points AS
 SELECT user_id,
    (COALESCE(sum(points), (0)::bigint))::integer AS total_points,
    (count(id))::integer AS movimientos,
    max(created_at) AS ultimo_movimiento
   FROM gamificacion.points_ledger pl
  GROUP BY user_id;

ALTER TABLE ONLY gamificacion.points_ledger ALTER COLUMN id SET DEFAULT nextval('gamificacion.points_ledger_id_seq'::regclass);

ALTER TABLE ONLY gamificacion.points_rules ALTER COLUMN id SET DEFAULT nextval('gamificacion.points_rules_id_seq'::regclass);

ALTER TABLE ONLY gamificacion.rewards_catalog ALTER COLUMN id SET DEFAULT nextval('gamificacion.badges_id_seq'::regclass);

ALTER TABLE ONLY gamificacion.user_level_history ALTER COLUMN id SET DEFAULT nextval('gamificacion.user_level_history_id_seq'::regclass);

ALTER TABLE ONLY gamificacion.user_rewards ALTER COLUMN id SET DEFAULT nextval('gamificacion.user_badges_id_seq'::regclass);

ALTER TABLE ONLY gamificacion.rewards_catalog
    ADD CONSTRAINT badges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gamificacion.levels_config
    ADD CONSTRAINT levels_config_min_points_key UNIQUE (min_points);

ALTER TABLE ONLY gamificacion.levels_config
    ADD CONSTRAINT levels_config_pkey PRIMARY KEY (level);

ALTER TABLE ONLY gamificacion.points_ledger
    ADD CONSTRAINT points_ledger_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE ONLY gamificacion.points_ledger
    ADD CONSTRAINT points_ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gamificacion.points_rules
    ADD CONSTRAINT points_rules_code_key UNIQUE (code);

ALTER TABLE ONLY gamificacion.points_rules
    ADD CONSTRAINT points_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gamificacion.recommendation_rules
    ADD CONSTRAINT recommendation_rules_pkey PRIMARY KEY (code);

ALTER TABLE ONLY gamificacion.user_rewards
    ADD CONSTRAINT user_badges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gamificacion.user_level_history
    ADD CONSTRAINT user_level_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gamificacion.user_level_history
    ADD CONSTRAINT user_level_history_user_id_level_key UNIQUE (user_id, level);

ALTER TABLE ONLY gamificacion.user_recommendations
    ADD CONSTRAINT user_recommendations_pkey PRIMARY KEY (user_id);

CREATE INDEX idx_levels_config_min_points ON gamificacion.levels_config USING btree (min_points) WHERE (is_active = true);

CREATE INDEX idx_points_ledger_user_fecha ON gamificacion.points_ledger USING btree (user_id, created_at DESC);

CREATE INDEX idx_points_rules_activas ON gamificacion.points_rules USING btree (source_type) WHERE (is_active = true);

CREATE INDEX idx_rewards_catalog_activas ON gamificacion.rewards_catalog USING btree (condition_type) WHERE (is_active = true);

CREATE INDEX idx_user_level_history_user ON gamificacion.user_level_history USING btree (user_id, reached_at DESC);

CREATE INDEX idx_user_rewards_catalogo ON gamificacion.user_rewards USING btree (reward_id) WHERE (reward_id IS NOT NULL);

CREATE INDEX idx_user_rewards_usuario ON gamificacion.user_rewards USING btree (user_id, earned_at DESC);

CREATE UNIQUE INDEX uq_user_rewards_dedupe ON gamificacion.user_rewards USING btree (dedupe_key);

CREATE TRIGGER trg_points_ledger_inmutable BEFORE DELETE OR UPDATE ON gamificacion.points_ledger FOR EACH ROW EXECUTE FUNCTION public.fn_points_ledger_inmutable();

CREATE TRIGGER trg_user_level_history_inmutable BEFORE DELETE OR UPDATE ON gamificacion.user_level_history FOR EACH ROW EXECUTE FUNCTION public.fn_user_level_history_inmutable();

CREATE TRIGGER trg_user_rewards_inmutable BEFORE DELETE OR UPDATE ON gamificacion.user_rewards FOR EACH ROW EXECUTE FUNCTION public.fn_user_rewards_inmutable();

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
