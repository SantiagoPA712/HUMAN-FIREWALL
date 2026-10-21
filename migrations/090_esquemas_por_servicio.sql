-- =====================================================================
-- 090_esquemas_por_servicio.sql
-- HU: arquitectura de microservicios por capas (seccion 11 del material:
-- "cada servicio administra sus propios datos").
--
-- Que hace:
--
--   Un ESQUEMA de PostgreSQL por microservicio, y cada tabla se mueve al
--   esquema del servicio que es su dueno:
--
--     identidad.users, cursos.courses, gamificacion.points_ledger, ...
--
--   La base sigue siendo una sola (el sistema se despliega como un solo
--   proceso), pero la separacion de datos ahora se ve en la base y no solo en
--   el codigo: cada repositorio escribe sus consultas con el nombre
--   calificado (identidad.users) y las pruebas de arquitectura comprueban que
--   ningun servicio use un esquema ajeno sin declararlo.
--
-- Que NO cambia:
--
--   - Ningun dato se borra ni se copia: ALTER TABLE ... SET SCHEMA solo cambia
--     el esquema. Indices, restricciones, llaves foraneas y secuencias se
--     mueven con la tabla.
--   - data.logs y data.logs_purges se quedan en el esquema "data" (lo exige
--     su HU); son del servicio de seguridad.
--   - event_outbox y schema_migrations quedan en public: son de la
--     plataforma (bus de eventos y runner de migraciones), no de un servicio.
--
-- Compatibilidad: se fija el search_path de la base para incluir todos los
-- esquemas. Asi las migraciones viejas, las funciones de los triggers y
-- cualquier consulta sin calificar siguen encontrando las tablas. El numero
-- 090 es del rango "comunes" (migrations/README.md): corre despues de las
-- migraciones de cada integrante en una base nueva.
--
-- Idempotente: solo mueve lo que todavia esta en public.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS identidad;
CREATE SCHEMA IF NOT EXISTS cursos;
CREATE SCHEMA IF NOT EXISTS evaluaciones;
CREATE SCHEMA IF NOT EXISTS gamificacion;
CREATE SCHEMA IF NOT EXISTS notificaciones;
CREATE SCHEMA IF NOT EXISTS reportes;
CREATE SCHEMA IF NOT EXISTS seguridad;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            -- identidad
            ('users', 'identidad'), ('password_reset_tokens', 'identidad'),
            ('user_invitations', 'identidad'), ('user_invitation_events', 'identidad'),
            ('teams', 'identidad'),
            -- cursos
            ('courses', 'cursos'), ('course_contents', 'cursos'),
            ('course_assignments', 'cursos'), ('lesson_progress', 'cursos'),
            -- evaluaciones
            ('simulations', 'evaluaciones'), ('simulation_steps', 'evaluaciones'),
            ('simulation_options', 'evaluaciones'), ('simulation_results', 'evaluaciones'),
            ('challenges', 'evaluaciones'), ('user_challenge_results', 'evaluaciones'),
            ('quiz_attempts', 'evaluaciones'),
            -- gamificacion
            ('points_ledger', 'gamificacion'), ('points_rules', 'gamificacion'),
            ('rewards_catalog', 'gamificacion'), ('user_rewards', 'gamificacion'),
            ('badges', 'gamificacion'), ('user_badges', 'gamificacion'),
            ('levels_config', 'gamificacion'), ('user_level_history', 'gamificacion'),
            ('recommendation_rules', 'gamificacion'), ('user_recommendations', 'gamificacion'),
            -- notificaciones
            ('notifications', 'notificaciones'), ('notification_deliveries', 'notificaciones'),
            ('notification_preferences', 'notificaciones'), ('email_jobs', 'notificaciones'),
            ('email_job_attempts', 'notificaciones'), ('email_notification_types', 'notificaciones'),
            ('email_preferences', 'notificaciones'), ('email_templates', 'notificaciones'),
            -- reportes
            ('report_exports', 'reportes'), ('report_schedules', 'reportes'),
            ('report_history', 'reportes'), ('report_notifications', 'reportes'),
            ('org_kpi_snapshots', 'reportes'), ('org_report_access_log', 'reportes'),
            -- seguridad
            ('anomaly_rules', 'seguridad'), ('anomaly_events', 'seguridad'),
            ('anomaly_status_history', 'seguridad'), ('audit_log', 'seguridad'),
            ('activity_logs', 'seguridad')
        ) AS t(tabla, esquema)
    LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = r.tabla) THEN
            EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', r.tabla, r.esquema);
        END IF;
    END LOOP;

    -- La vista del total de puntos es de gamificacion.
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_user_points') THEN
        ALTER VIEW public.v_user_points SET SCHEMA gamificacion;
    END IF;
END $$;

-- Las funciones de los triggers (inmutabilidad del historial, de los logs,
-- etc.) resuelven los nombres de tabla con el search_path de quien las
-- ejecuta. Se les fija uno propio para que funcionen igual desde cualquier
-- sesion, aunque no tenga el search_path de la aplicacion.
DO $$
DECLARE
    f RECORD;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS firma
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN pg_language l ON l.oid = p.prolang
         WHERE n.nspname IN ('public', 'data')
           AND l.lanname = 'plpgsql'
    LOOP
        EXECUTE format(
            'ALTER FUNCTION %s SET search_path = public, identidad, cursos, evaluaciones, '
            'gamificacion, notificaciones, reportes, seguridad, data',
            f.firma
        );
    END LOOP;
END $$;

-- search_path de la base: aplica a las conexiones nuevas. Algunos
-- proveedores no dejan cambiar la base (permiso insuficiente); en ese caso
-- igual alcanza con el que fija el pool al conectar (compartido/config/db.js).
DO $$
BEGIN
    EXECUTE format(
        'ALTER DATABASE %I SET search_path = public, identidad, cursos, evaluaciones, '
        'gamificacion, notificaciones, reportes, seguridad, data',
        current_database()
    );
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sin permiso para ALTER DATABASE: el search_path lo fija el pool de conexiones.';
END $$;

-- Y para la sesion que esta aplicando las migraciones.
SET search_path = public, identidad, cursos, evaluaciones, gamificacion, notificaciones, reportes, seguridad, data;
