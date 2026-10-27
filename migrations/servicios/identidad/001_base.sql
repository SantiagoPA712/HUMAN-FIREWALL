-- =====================================================================
-- 001_base.sql -- base de datos propia del servicio de identidad
--
-- Estructura de las tablas del servicio (identidad.*) tal como
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

CREATE OR REPLACE FUNCTION public.user_invitation_events_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'reportes', 'seguridad', 'data'
AS $function$
BEGIN
    RAISE EXCEPTION 'user_invitation_events es de solo insercion (%)', TG_OP;
END;
$function$;

CREATE SCHEMA IF NOT EXISTS identidad;

CREATE TABLE identidad.password_reset_tokens (
    id integer NOT NULL,
    user_id integer,
    token character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE identidad.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE identidad.password_reset_tokens_id_seq OWNED BY identidad.password_reset_tokens.id;

CREATE TABLE identidad.teams (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE identidad.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE identidad.teams_id_seq OWNED BY identidad.teams.id;

CREATE TABLE identidad.user_invitation_events (
    id bigint NOT NULL,
    invitation_id bigint NOT NULL,
    action character varying(20) NOT NULL,
    actor_user_id integer,
    invited_by integer,
    email character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_invitation_events_action_check CHECK (((action)::text = ANY ((ARRAY['created'::character varying, 'resent'::character varying, 'cancelled'::character varying, 'accepted'::character varying, 'expired'::character varying, 'resend_requested'::character varying])::text[])))
);

CREATE SEQUENCE identidad.user_invitation_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE identidad.user_invitation_events_id_seq OWNED BY identidad.user_invitation_events.id;

CREATE TABLE identidad.user_invitations (
    id bigint NOT NULL,
    email character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    language character varying(5),
    token_hash character(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    invited_by integer,
    send_count integer DEFAULT 1 NOT NULL,
    resend_requested_at timestamp with time zone,
    accepted_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    expired_at timestamp with time zone,
    CONSTRAINT user_invitations_email_check CHECK (((email)::text = lower((email)::text))),
    CONSTRAINT user_invitations_language_check CHECK (((language IS NULL) OR ((language)::text = ANY ((ARRAY['es'::character varying, 'en'::character varying])::text[])))),
    CONSTRAINT user_invitations_role_check CHECK (((role)::text = ANY ((ARRAY['employee'::character varying, 'instructor'::character varying, 'rh'::character varying])::text[]))),
    CONSTRAINT user_invitations_send_count_check CHECK ((send_count > 0)),
    CONSTRAINT user_invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[])))
);

CREATE SEQUENCE identidad.user_invitations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE identidad.user_invitations_id_seq OWNED BY identidad.user_invitations.id;

CREATE TABLE identidad.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255),
    role character varying(50) DEFAULT 'employee'::character varying,
    failed_attempts integer DEFAULT 0,
    lock_until timestamp without time zone,
    is_active boolean DEFAULT true,
    oauth_provider character varying(50),
    oauth_id character varying(255),
    total_points integer DEFAULT 0,
    level integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    team_id integer,
    language character varying(5),
    full_name character varying(150),
    phone character varying(16),
    CONSTRAINT chk_users_role CHECK (((role)::text = ANY ((ARRAY['employee'::character varying, 'instructor'::character varying, 'admin'::character varying, 'rh'::character varying, 'security'::character varying, 'manager'::character varying])::text[]))),
    CONSTRAINT users_language_valido CHECK (((language IS NULL) OR ((language)::text = ANY ((ARRAY['es'::character varying, 'en'::character varying])::text[])))),
    CONSTRAINT users_phone_formato CHECK (((phone IS NULL) OR ((phone)::text ~ '^\+?[0-9]{7,15}$'::text)))
);

COMMENT ON COLUMN identidad.users.level IS 'Cache del nivel derivado de points_ledger + levels_config. No es fuente de verdad: recalcular con levels.service.';

CREATE SEQUENCE identidad.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE identidad.users_id_seq OWNED BY identidad.users.id;

ALTER TABLE ONLY identidad.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('identidad.password_reset_tokens_id_seq'::regclass);

ALTER TABLE ONLY identidad.teams ALTER COLUMN id SET DEFAULT nextval('identidad.teams_id_seq'::regclass);

ALTER TABLE ONLY identidad.user_invitation_events ALTER COLUMN id SET DEFAULT nextval('identidad.user_invitation_events_id_seq'::regclass);

ALTER TABLE ONLY identidad.user_invitations ALTER COLUMN id SET DEFAULT nextval('identidad.user_invitations_id_seq'::regclass);

ALTER TABLE ONLY identidad.users ALTER COLUMN id SET DEFAULT nextval('identidad.users_id_seq'::regclass);

ALTER TABLE ONLY identidad.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identidad.teams
    ADD CONSTRAINT teams_name_key UNIQUE (name);

ALTER TABLE ONLY identidad.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identidad.user_invitation_events
    ADD CONSTRAINT user_invitation_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identidad.user_invitations
    ADD CONSTRAINT user_invitations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY identidad.user_invitations
    ADD CONSTRAINT user_invitations_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY identidad.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY identidad.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX idx_user_invitation_events_invitacion ON identidad.user_invitation_events USING btree (invitation_id, occurred_at);

CREATE INDEX idx_user_invitations_estado ON identidad.user_invitations USING btree (status, created_at DESC);

CREATE INDEX idx_user_invitations_vencimiento ON identidad.user_invitations USING btree (expires_at) WHERE ((status)::text = 'pending'::text);

CREATE INDEX idx_users_team ON identidad.users USING btree (team_id) WHERE (team_id IS NOT NULL);

CREATE UNIQUE INDEX uq_user_invitations_pendiente ON identidad.user_invitations USING btree (email) WHERE ((status)::text = 'pending'::text);

CREATE TRIGGER trg_user_invitation_events_inmutable BEFORE DELETE OR UPDATE ON identidad.user_invitation_events FOR EACH ROW EXECUTE FUNCTION public.user_invitation_events_inmutable();

ALTER TABLE ONLY identidad.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES identidad.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY identidad.user_invitation_events
    ADD CONSTRAINT user_invitation_events_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES identidad.user_invitations(id);

ALTER TABLE ONLY identidad.user_invitations
    ADD CONSTRAINT user_invitations_accepted_user_id_fkey FOREIGN KEY (accepted_user_id) REFERENCES identidad.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY identidad.user_invitations
    ADD CONSTRAINT user_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES identidad.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY identidad.users
    ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES identidad.teams(id) ON DELETE SET NULL;

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
