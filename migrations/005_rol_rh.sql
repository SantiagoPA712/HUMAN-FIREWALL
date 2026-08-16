-- =====================================================================
-- 005_rol_rh.sql
-- Criterio tecnico 3: el endpoint de puntos debe respetar las mismas
-- restricciones de rol que el historial de desempeno: propio usuario,
-- admin o rh.
--
-- El rol 'rh' no existia en el sistema. users.role era un VARCHAR libre
-- sin validacion, asi que cualquier string entraba como rol valido.
-- =====================================================================

-- Normaliza cualquier valor fuera del catalogo antes de aplicar la
-- restriccion, para que la migracion no falle sobre datos existentes.
UPDATE users
SET role = 'employee'
WHERE role IS NULL
   OR role NOT IN ('employee','instructor','admin','rh');

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_role;
ALTER TABLE users ADD CONSTRAINT chk_users_role
    CHECK (role IN ('employee','instructor','admin','rh'));
