-- =====================================================================
-- 001_base.sql -- base de datos propia del servicio de cursos
--
-- Estructura de las tablas del servicio (cursos.*) tal como
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

CREATE SCHEMA IF NOT EXISTS cursos;

CREATE TABLE cursos.course_assignments (
    id integer NOT NULL,
    course_id integer,
    user_id integer,
    status character varying(50) DEFAULT 'assigned'::character varying,
    completed_at timestamp without time zone,
    assigned_at timestamp with time zone DEFAULT now(),
    due_date timestamp with time zone,
    deadline_notified_at timestamp with time zone
);

CREATE SEQUENCE cursos.course_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE cursos.course_assignments_id_seq OWNED BY cursos.course_assignments.id;

CREATE TABLE cursos.course_contents (
    id integer NOT NULL,
    course_id integer,
    content_type character varying(50) NOT NULL,
    body text NOT NULL,
    order_idx integer DEFAULT 0,
    points_reward integer DEFAULT 10
);

CREATE SEQUENCE cursos.course_contents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE cursos.course_contents_id_seq OWNED BY cursos.course_contents.id;

CREATE TABLE cursos.courses (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    instructor_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_critical boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE cursos.courses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE cursos.courses_id_seq OWNED BY cursos.courses.id;

CREATE TABLE cursos.lesson_progress (
    id integer NOT NULL,
    user_id integer NOT NULL,
    content_id integer NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE cursos.lesson_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE cursos.lesson_progress_id_seq OWNED BY cursos.lesson_progress.id;

ALTER TABLE ONLY cursos.course_assignments ALTER COLUMN id SET DEFAULT nextval('cursos.course_assignments_id_seq'::regclass);

ALTER TABLE ONLY cursos.course_contents ALTER COLUMN id SET DEFAULT nextval('cursos.course_contents_id_seq'::regclass);

ALTER TABLE ONLY cursos.courses ALTER COLUMN id SET DEFAULT nextval('cursos.courses_id_seq'::regclass);

ALTER TABLE ONLY cursos.lesson_progress ALTER COLUMN id SET DEFAULT nextval('cursos.lesson_progress_id_seq'::regclass);

ALTER TABLE ONLY cursos.course_assignments
    ADD CONSTRAINT course_assignments_course_id_user_id_key UNIQUE (course_id, user_id);

ALTER TABLE ONLY cursos.course_assignments
    ADD CONSTRAINT course_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cursos.course_contents
    ADD CONSTRAINT course_contents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cursos.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cursos.lesson_progress
    ADD CONSTRAINT lesson_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY cursos.lesson_progress
    ADD CONSTRAINT lesson_progress_user_id_content_id_key UNIQUE (user_id, content_id);

CREATE INDEX idx_course_assignments_vencimientos ON cursos.course_assignments USING btree (due_date) WHERE ((due_date IS NOT NULL) AND (deadline_notified_at IS NULL));

CREATE INDEX idx_courses_criticos ON cursos.courses USING btree (id) WHERE (is_critical = true);

CREATE INDEX idx_lesson_progress_user ON cursos.lesson_progress USING btree (user_id);

ALTER TABLE ONLY cursos.course_assignments
    ADD CONSTRAINT course_assignments_course_id_fkey FOREIGN KEY (course_id) REFERENCES cursos.courses(id) ON DELETE CASCADE;

ALTER TABLE ONLY cursos.course_contents
    ADD CONSTRAINT course_contents_course_id_fkey FOREIGN KEY (course_id) REFERENCES cursos.courses(id) ON DELETE CASCADE;

ALTER TABLE ONLY cursos.lesson_progress
    ADD CONSTRAINT lesson_progress_content_id_fkey FOREIGN KEY (content_id) REFERENCES cursos.course_contents(id) ON DELETE CASCADE;

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
