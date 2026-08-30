-- =====================================================================
-- 026_exportaciones_de_reportes.sql
-- HU: Reportes de desempeno para RH.
--
-- Esta tabla cumple dos funciones que en el enunciado aparecen separadas y
-- que en realidad son la misma fila:
--
--   Criterio tecnico 5: una exportacion grande se encola como job asincrono y
--   la respuesta devuelve un export_id con el que despues se consulta si el
--   archivo ya esta listo. Eso necesita persistir el estado del job.
--
--   Criterio tecnico 6: cada exportacion debe quedar registrada con el ID del
--   solicitante, el tipo de reporte, los filtros aplicados y el timestamp del
--   servidor.
--
-- Guardar el estado del job y la auditoria por separado significaria escribir
-- dos veces lo mismo y arriesgar que se contradigan. Es una sola fila: nace
-- cuando alguien pide la exportacion y se completa cuando el archivo esta.
--
-- IMPORTANTE: el criterio 6 exige que estos registros NO sean accesibles
-- desde el frontend ni se expongan en ninguna respuesta de la API. Por eso
-- el endpoint de estado devuelve unicamente id, formato, estado y cantidad de
-- filas: nunca `filters` ni `requested_by`. Ver report.controller.js.
--
-- Depende de: schema.sql (users)
-- =====================================================================

CREATE TABLE IF NOT EXISTS report_exports (
    id            BIGSERIAL PRIMARY KEY,

    -- Identificador publico, el unico que sale hacia el cliente.
    --
    -- Se expone este y no el id numerico porque el id es secuencial: con
    -- /exports/41 cualquiera prueba 40, 39, 38 y enumera las exportaciones
    -- del resto de la organizacion. Un valor aleatorio no se puede recorrer.
    export_uid    VARCHAR(64) NOT NULL UNIQUE,

    -- Criterio 6: quien la pidio. Sin ON DELETE CASCADE: la auditoria no
    -- puede desaparecer porque se dio de baja al usuario que exporto.
    requested_by  INT NOT NULL REFERENCES users(id),

    report_type   VARCHAR(50) NOT NULL,
    format        VARCHAR(10) NOT NULL CHECK (format IN ('csv', 'pdf')),

    -- Criterio 6: los filtros exactos con los que se genero. Es lo que
    -- permite responder "que datos se llevo esta persona".
    filters       JSONB NOT NULL DEFAULT '{}'::jsonb,

    row_count     INT,

    -- Nombre generado por el sistema.
    --
    -- Criterio tecnico 5: "nunca con datos sensibles en el nombre". Por eso
    -- el archivo se llama con el export_uid y no con el correo del usuario,
    -- el equipo consultado ni el rango de fechas: el nombre de un archivo
    -- viaja en encabezados, historiales de descargas y logs de servidores
    -- intermedios.
    file_name     VARCHAR(120),

    -- pending    -> encolada, el worker todavia no la tomo
    -- processing -> generandose
    -- ready      -> archivo disponible
    -- failed     -> fallo la generacion (error queda en `error`)
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
    error         TEXT,

    -- Criterio 6: timestamp del servidor, no del cliente.
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ
);

-- Para responder "que exporto esta persona" sin recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS idx_report_exports_solicitante
    ON report_exports (requested_by, created_at DESC);

-- El worker busca lo pendiente; el indice parcial evita recorrer el historial
-- completo de exportaciones ya resueltas.
CREATE INDEX IF NOT EXISTS idx_report_exports_pendientes
    ON report_exports (created_at) WHERE status = 'pending';
