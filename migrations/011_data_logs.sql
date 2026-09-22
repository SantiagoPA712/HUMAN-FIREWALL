-- =====================================================================
-- 011_data_logs.sql
-- HU: registro centralizado de logs de auditoria (data.logs).
--
-- "Yo como sistema quiero registrar en una tabla centralizada (data.logs)
-- las acciones criticas realizadas por los usuarios y por el propio sistema,
-- para garantizar trazabilidad, soportar auditorias de seguridad y facilitar
-- la investigacion de incidentes."
--
-- Cubre, del lado de la base:
--   CT1  la tabla con los campos que pide el criterio
--   CT4  inmutabilidad (trigger + permisos)
--   CT6  la purga por retencion como UNICA forma de borrar, con evidencia
--   CT8  indices por los campos mas consultados
--
-- ---------------------------------------------------------------------
-- Relacion con audit_log (migracion 030)
-- ---------------------------------------------------------------------
-- audit_log NO se reemplaza. Es el registro especifico de ajustes manuales de
-- puntos/nivel/insignias, con motivo obligatorio, y lo consume el panel de
-- seguridad. data.logs es el registro transversal de TODO el sistema: esos
-- mismos ajustes tambien llegan aca, junto con los logins fallidos, los
-- cambios de rol, las exportaciones y los cambios de configuracion.
--
-- Depende de: nada. A proposito no tiene llaves foraneas (ver user_id).
-- =====================================================================

-- El esquema es parte del nombre que pide la HU: data.logs. Separarlo de
-- public tambien deja claro, al listar tablas, que esto no es un dato de
-- negocio sino un registro del sistema.
CREATE SCHEMA IF NOT EXISTS data;

CREATE TABLE IF NOT EXISTS data.logs (
    id              BIGSERIAL PRIMARY KEY,

    -- Identificador generado por el servidor ANTES de encolar el log.
    -- El registro es asincrono (CT2) y el bus reintenta hasta 5 veces: si un
    -- intento alcanza a insertar y falla despues, el reintento no puede
    -- duplicar la fila. El UNIQUE sobre log_uid es la llave de idempotencia.
    log_uid         UUID NOT NULL UNIQUE,

    -- Quien ejecuto la accion. SIN llave foranea a users, a proposito:
    -- con ON DELETE CASCADE, borrar a un usuario borraria su historial (el
    -- mismo fallo critico que tuvo user_rewards, ver migracion 007); sin
    -- CASCADE, el DELETE del usuario fallaria contra el trigger de
    -- inmutabilidad. El log tiene que sobrevivir a lo que audita.
    -- NULL cuando la accion la ejecuta el propio sistema (actor_type='system').
    user_id         INT,

    -- 'user' o 'system'. El criterio dice "user_id (o system si no aplica)":
    -- un INT no puede guardar la palabra system, asi que va en su columna.
    actor_type      VARCHAR(10) NOT NULL DEFAULT 'user'
                    CHECK (actor_type IN ('user', 'system')),

    -- Copia del correo al momento de la accion. Si el usuario cambia de
    -- correo o se da de baja, el log sigue diciendo quien fue. En un login
    -- fallido es el correo que se intento usar, exista o no la cuenta.
    actor_email     VARCHAR(255),

    -- Que se hizo (create, update, delete, role_change, login_failed,
    -- export, config_change...). El catalogo vive en dataLogs.service.js.
    -- Sin CHECK a proposito: sumar una accion nueva no deberia exigir una
    -- migracion, y un valor desconocido igual se registra (un log que se
    -- niega a registrar algo raro es peor que uno que lo registra).
    action_type     VARCHAR(40) NOT NULL,

    -- Modulo de origen (auth, users, gamification, security, reports, logs,
    -- system). El criterio de aceptacion 2 filtra por "modulo" y el
    -- criterio tecnico 1 no lo lista entre los campos: sin esta columna el
    -- filtro no tendria sobre que trabajar.
    module          VARCHAR(40) NOT NULL,

    -- Sobre que recurso (user, reward, anomaly, report_schedule...) y cual.
    -- resource_id es texto: no todos los recursos tienen id numerico (las
    -- exportaciones usan un uid, por ejemplo).
    resource_type   VARCHAR(40) NOT NULL,
    resource_id     VARCHAR(100),

    -- Valor anterior y nuevo, cuando aplica. JSONB porque cada recurso tiene
    -- su forma. Llegan ya enmascarados (CT5): nunca hay una contrasena o un
    -- token en texto plano, sino "[REDACTED]".
    old_value       JSONB,
    new_value       JSONB,

    -- IP de origen. Texto y no INET: un valor raro (un proxy que manda algo
    -- inesperado) haria fallar el INSERT, y un log que se pierde por el
    -- formato de la IP es peor que una IP mal formateada.
    ip_address      VARCHAR(64),

    -- ID de correlacion. Lo genera el middleware traceId para cada request,
    -- o lo hereda del encabezado X-Trace-Id si la llamada viene de otro
    -- modulo. Con el se unen todas las filas que produjo una misma accion.
    trace_id        VARCHAR(64),

    -- "Timestamp del servidor" del criterio tecnico 1. Lo pone el servidor
    -- en el momento de la accion, NO el worker que inserta la fila: como el
    -- registro es asincrono, la insercion puede ocurrir segundos despues (o
    -- mas, si hubo reintentos) y esa demora no puede cambiar la hora del
    -- hecho. recorded_at queda como dato tecnico de cuando se persistio.
    occurred_at     TIMESTAMPTZ NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Una accion del sistema no tiene usuario.
    CONSTRAINT chk_logs_actor_sistema
        CHECK (actor_type = 'user' OR user_id IS NULL)
);

-- ---------------------------------------------------------------------
-- Indices (criterio tecnico 8)
-- ---------------------------------------------------------------------
-- Todas las consultas del panel ordenan por fecha, asi que cada filtro lleva
-- occurred_at como segunda columna: el indice resuelve el WHERE y el ORDER BY
-- a la vez, y la paginacion no tiene que ordenar la tabla entera.
CREATE INDEX IF NOT EXISTS idx_logs_occurred_at
    ON data.logs (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_user
    ON data.logs (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_logs_action_type
    ON data.logs (action_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_logs_resource_type
    ON data.logs (resource_type, occurred_at DESC);

-- No lo pide el criterio 8, pero el filtro por modulo es del criterio de
-- aceptacion 2 y sin indice seria el unico filtro que recorre la tabla.
CREATE INDEX IF NOT EXISTS idx_logs_module
    ON data.logs (module, occurred_at DESC);

-- ---------------------------------------------------------------------
-- Inmutabilidad (criterio tecnico 4)
-- ---------------------------------------------------------------------
-- UPDATE: prohibido siempre. Un error se corrige con una fila nueva.
-- DELETE: prohibido SALVO que la sesion declare que esta ejecutando la
--         politica de retencion. Mismo mecanismo que report_history
--         (migracion 031):
--
--             BEGIN;
--             SET LOCAL app.retencion_logs = 'on';
--             DELETE FROM data.logs WHERE occurred_at < ...;
--             COMMIT;
--
--         Es una linea que nadie escribe por accidente. Solo la escribe
--         dataLogs.service.aplicarRetencion(), y SET LOCAL muere con la
--         transaccion: no queda la puerta abierta para la siguiente.
CREATE OR REPLACE FUNCTION data.fn_logs_inmutable()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_logs_inmutable ON data.logs;
CREATE TRIGGER trg_logs_inmutable
    BEFORE UPDATE OR DELETE ON data.logs
    FOR EACH ROW
    EXECUTE FUNCTION data.fn_logs_inmutable();

-- Los triggers FOR EACH ROW no se disparan con TRUNCATE: sin este, un
-- TRUNCATE vaciaria la tabla entera sin pasar por ninguna regla.
CREATE OR REPLACE FUNCTION data.fn_logs_sin_truncate()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'data.logs no se puede vaciar con TRUNCATE.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_logs_sin_truncate ON data.logs;
CREATE TRIGGER trg_logs_sin_truncate
    BEFORE TRUNCATE ON data.logs
    FOR EACH STATEMENT
    EXECUTE FUNCTION data.fn_logs_sin_truncate();

-- Permisos de base de datos. Ojo con el alcance: un superusuario (el
-- usuario postgres con el que corre el contenedor de desarrollo) se salta
-- los GRANT/REVOKE. Por eso la defensa principal es el trigger, que SI
-- aplica al superusuario. En produccion la app deberia conectarse con un
-- rol propio sin privilegios de superusuario; ahi el REVOKE tambien cuenta.
REVOKE UPDATE, DELETE, TRUNCATE ON data.logs FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Evidencia de las purgas (criterio tecnico 6)
-- ---------------------------------------------------------------------
-- "dejando evidencia de la purga (cantidad de registros, rango de fechas) en
-- un log de sistema separado".
--
-- Separado a proposito: si la evidencia viviera en data.logs, la siguiente
-- purga podria borrar la evidencia de la anterior.
CREATE TABLE IF NOT EXISTS data.logs_purges (
    id                BIGSERIAL PRIMARY KEY,
    executed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Politica vigente en esa corrida y fecha de corte que se aplico.
    retention_months  INT NOT NULL CHECK (retention_months > 0),
    cutoff            TIMESTAMPTZ NOT NULL,

    -- Cuantos registros se eliminaron y que rango de fechas cubrian.
    deleted_count     INT NOT NULL CHECK (deleted_count >= 0),
    oldest_deleted    TIMESTAMPTZ,
    newest_deleted    TIMESTAMPTZ,

    trace_id          VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_logs_purges_fecha
    ON data.logs_purges (executed_at DESC);

-- La evidencia de una purga no se puede purgar.
CREATE OR REPLACE FUNCTION data.fn_logs_purges_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'data.logs_purges es la evidencia de las purgas: la operacion % no esta permitida.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_logs_purges_inmutable ON data.logs_purges;
CREATE TRIGGER trg_logs_purges_inmutable
    BEFORE UPDATE OR DELETE ON data.logs_purges
    FOR EACH ROW
    EXECUTE FUNCTION data.fn_logs_purges_inmutable();

REVOKE UPDATE, DELETE, TRUNCATE ON data.logs_purges FROM PUBLIC;
