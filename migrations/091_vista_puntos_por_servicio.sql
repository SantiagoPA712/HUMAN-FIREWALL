-- =====================================================================
-- 091_vista_puntos_por_servicio.sql
-- HU: base de datos por servicio (material: "No compartir base de datos
-- entre servicios").
--
-- gamificacion.v_user_points hacia un LEFT JOIN desde identidad.users para
-- que todo usuario tuviera fila, aunque fuera con 0 puntos. Con una base por
-- servicio esa tabla vive en otra base, asi que la vista se arma solo con el
-- historial de gamificacion: quien no tiene movimientos no aparece, y el
-- codigo ya lo trataba como 0 puntos (COALESCE / "|| 0").
--
-- Mismas columnas y tipos que antes. Idempotente.
-- =====================================================================

CREATE OR REPLACE VIEW gamificacion.v_user_points AS
SELECT pl.user_id,
       COALESCE(SUM(pl.points), 0)::integer AS total_points,
       COUNT(pl.id)::integer                AS movimientos,
       MAX(pl.created_at)                   AS ultimo_movimiento
  FROM gamificacion.points_ledger pl
 GROUP BY pl.user_id;
