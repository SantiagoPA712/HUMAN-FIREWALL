-- =====================================================================
-- 028_rol_seguridad.sql
-- HU: Analisis de metricas de uso y deteccion de abuso del sistema de puntos.
-- Criterio tecnico 3: el endpoint de anomalias exige que el claim `role` del
-- JWT sea 'security' o 'admin'.
--
-- El rol 'security' no existia. La migracion 005 dejo users.role con un CHECK
-- cerrado sobre ('employee','instructor','admin','rh'), asi que hoy es
-- imposible crear un usuario del area de seguridad: la restriccion lo rechaza.
--
-- Se amplia el CHECK y se siembra una cuenta, igual que en 027, para que la
-- pantalla de seguridad sea alcanzable sin tocar la base a mano.
--
-- Depende de: 005_rol_rh.sql (el CHECK que se amplia), 025_equipos.sql
-- =====================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_role;
ALTER TABLE users ADD CONSTRAINT chk_users_role
    CHECK (role IN ('employee','instructor','admin','rh','security'));

-- ---------------------------------------------------------------------
-- Cuenta del area de seguridad
-- ---------------------------------------------------------------------
-- Hash generado con el bcrypt del proyecto (cost 10) y verificado contra su
-- contrasena antes de escribirlo aca:
--
--   seguridad@humanfirewall.com  ->  Seguridad123
--
-- Mismo aviso que en 027: son credenciales de DESARROLLO, publicadas en el
-- repositorio. Cambiarlas antes de exponer el sistema.
INSERT INTO users (email, password, role, is_active, team_id)
VALUES ('seguridad@humanfirewall.com',
        '$2b$10$JRxqCFPTqX18bio1iv8tIeDONuOHRUbH72h/L0jRhQTFK.Cx7TQXy',
        'security', true, 1)
ON CONFLICT (email) DO UPDATE
   SET password  = EXCLUDED.password,
       role      = 'security',
       is_active = true;
