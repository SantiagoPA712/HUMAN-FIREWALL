-- =====================================================================
-- 001_base.sql -- base de datos propia del servicio de evaluaciones
--
-- Estructura de las tablas del servicio (evaluaciones.*) tal como
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

CREATE SCHEMA IF NOT EXISTS evaluaciones;

CREATE TABLE evaluaciones.challenges (
    id character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    points_reward integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    course_id integer
);

CREATE TABLE evaluaciones.quiz_attempts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    quiz_ref character varying(50) NOT NULL,
    quiz_type character varying(20) NOT NULL,
    course_id integer,
    score integer DEFAULT 0 NOT NULL,
    passing_score integer DEFAULT 60 NOT NULL,
    passed boolean DEFAULT false NOT NULL,
    attempt_no integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quiz_attempts_passing_score_check CHECK (((passing_score >= 0) AND (passing_score <= 100))),
    CONSTRAINT quiz_attempts_quiz_type_check CHECK (((quiz_type)::text = ANY ((ARRAY['simulation'::character varying, 'challenge'::character varying])::text[]))),
    CONSTRAINT quiz_attempts_score_check CHECK (((score >= 0) AND (score <= 100)))
);

CREATE SEQUENCE evaluaciones.quiz_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE evaluaciones.quiz_attempts_id_seq OWNED BY evaluaciones.quiz_attempts.id;

CREATE TABLE evaluaciones.simulation_options (
    id integer NOT NULL,
    step_id integer,
    option_text text NOT NULL,
    is_correct boolean DEFAULT false,
    points_awarded integer DEFAULT 0,
    feedback_text text
);

CREATE SEQUENCE evaluaciones.simulation_options_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE evaluaciones.simulation_options_id_seq OWNED BY evaluaciones.simulation_options.id;

CREATE TABLE evaluaciones.simulation_results (
    id integer NOT NULL,
    user_id integer,
    simulation_id integer,
    total_score integer DEFAULT 0,
    status character varying(50) DEFAULT 'completed'::character varying,
    completed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE evaluaciones.simulation_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE evaluaciones.simulation_results_id_seq OWNED BY evaluaciones.simulation_results.id;

CREATE TABLE evaluaciones.simulation_steps (
    id integer NOT NULL,
    simulation_id integer,
    scenario_text text NOT NULL,
    order_idx integer DEFAULT 1
);

CREATE SEQUENCE evaluaciones.simulation_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE evaluaciones.simulation_steps_id_seq OWNED BY evaluaciones.simulation_steps.id;

CREATE TABLE evaluaciones.simulations (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    difficulty character varying(50) DEFAULT 'beginner'::character varying,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    course_id integer
);

CREATE SEQUENCE evaluaciones.simulations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE evaluaciones.simulations_id_seq OWNED BY evaluaciones.simulations.id;

CREATE TABLE evaluaciones.user_challenge_results (
    id integer NOT NULL,
    user_id integer,
    challenge_id character varying(50),
    won boolean DEFAULT false,
    completed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE evaluaciones.user_challenge_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE evaluaciones.user_challenge_results_id_seq OWNED BY evaluaciones.user_challenge_results.id;

ALTER TABLE ONLY evaluaciones.quiz_attempts ALTER COLUMN id SET DEFAULT nextval('evaluaciones.quiz_attempts_id_seq'::regclass);

ALTER TABLE ONLY evaluaciones.simulation_options ALTER COLUMN id SET DEFAULT nextval('evaluaciones.simulation_options_id_seq'::regclass);

ALTER TABLE ONLY evaluaciones.simulation_results ALTER COLUMN id SET DEFAULT nextval('evaluaciones.simulation_results_id_seq'::regclass);

ALTER TABLE ONLY evaluaciones.simulation_steps ALTER COLUMN id SET DEFAULT nextval('evaluaciones.simulation_steps_id_seq'::regclass);

ALTER TABLE ONLY evaluaciones.simulations ALTER COLUMN id SET DEFAULT nextval('evaluaciones.simulations_id_seq'::regclass);

ALTER TABLE ONLY evaluaciones.user_challenge_results ALTER COLUMN id SET DEFAULT nextval('evaluaciones.user_challenge_results_id_seq'::regclass);

ALTER TABLE ONLY evaluaciones.challenges
    ADD CONSTRAINT challenges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evaluaciones.quiz_attempts
    ADD CONSTRAINT quiz_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evaluaciones.simulation_options
    ADD CONSTRAINT simulation_options_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evaluaciones.simulation_results
    ADD CONSTRAINT simulation_results_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evaluaciones.simulation_steps
    ADD CONSTRAINT simulation_steps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evaluaciones.simulations
    ADD CONSTRAINT simulations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evaluaciones.user_challenge_results
    ADD CONSTRAINT user_challenge_results_pkey PRIMARY KEY (id);

ALTER TABLE ONLY evaluaciones.user_challenge_results
    ADD CONSTRAINT user_challenge_results_user_id_challenge_id_key UNIQUE (user_id, challenge_id);

CREATE INDEX idx_challenges_curso ON evaluaciones.challenges USING btree (course_id) WHERE (course_id IS NOT NULL);

CREATE INDEX idx_quiz_attempts_aprobados ON evaluaciones.quiz_attempts USING btree (user_id, quiz_type, quiz_ref) WHERE (passed = true);

CREATE INDEX idx_quiz_attempts_curso ON evaluaciones.quiz_attempts USING btree (user_id, course_id) WHERE (course_id IS NOT NULL);

CREATE INDEX idx_quiz_attempts_user_fecha ON evaluaciones.quiz_attempts USING btree (user_id, created_at);

CREATE INDEX idx_quiz_attempts_user_quiz ON evaluaciones.quiz_attempts USING btree (user_id, quiz_type, quiz_ref);

CREATE INDEX idx_simulations_curso ON evaluaciones.simulations USING btree (course_id) WHERE (course_id IS NOT NULL);

ALTER TABLE ONLY evaluaciones.simulation_options
    ADD CONSTRAINT simulation_options_step_id_fkey FOREIGN KEY (step_id) REFERENCES evaluaciones.simulation_steps(id) ON DELETE CASCADE;

ALTER TABLE ONLY evaluaciones.simulation_results
    ADD CONSTRAINT simulation_results_simulation_id_fkey FOREIGN KEY (simulation_id) REFERENCES evaluaciones.simulations(id) ON DELETE CASCADE;

ALTER TABLE ONLY evaluaciones.simulation_steps
    ADD CONSTRAINT simulation_steps_simulation_id_fkey FOREIGN KEY (simulation_id) REFERENCES evaluaciones.simulations(id) ON DELETE CASCADE;

ALTER TABLE ONLY evaluaciones.user_challenge_results
    ADD CONSTRAINT user_challenge_results_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES evaluaciones.challenges(id) ON DELETE CASCADE;

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
