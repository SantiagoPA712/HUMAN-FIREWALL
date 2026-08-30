-- =====================================================================
-- 027_usuarios_iniciales.sql
-- Cuentas de admin y de RH listas para usar.
--
-- Por que hacia falta:
--
-- schema.sql ya insertaba admin@humanfirewall.com, pero con un hash bcrypt
-- que NO corresponde a ninguna contrasena conocida. Se verificaron las
-- candidatas obvias ('AdminPassword123!', 'admin', 'Admin123', 'password') y
-- ninguna valida contra ese hash. O sea: existia un usuario admin al que
-- nadie podia entrar.
--
-- Eso explica el "BYPASS DE EMERGENCIA" que tenia auth.controller en las
-- primeras versiones del proyecto: un if que dejaba pasar un correo y una
-- clave escritos a mano, saltandose la verificacion. Se quito hace varios
-- commits, y desde entonces simplemente no habia forma de entrar como admin.
--
-- Tampoco existia ninguna cuenta con rol 'rh', que es la que necesita la HU
-- de reportes: el rol se agrego en la migracion 005 y nunca se le asigno a
-- nadie.
--
-- Los hashes de abajo se generaron con el bcrypt del proyecto (cost 10) y se
-- verificaron contra su contrasena antes de escribirlos aca.
--
--   admin@humanfirewall.com  ->  Admin123
--   rh@humanfirewall.com     ->  Rh123456
--
-- ---------------------------------------------------------------------
-- AVISO
-- ---------------------------------------------------------------------
-- Estas son credenciales de DESARROLLO. Estan en un archivo versionado y
-- publicado en GitHub: cualquiera que lea el repositorio las conoce. Antes de
-- exponer el sistema en internet hay que cambiarlas, o directamente borrar
-- estas dos cuentas y crear las reales.
--
-- Depende de: schema.sql (users), 005_rol_rh.sql (el rol 'rh'),
--             025_equipos.sql (teams)
-- =====================================================================

-- Admin.
--
-- Se usa UPDATE ademas de INSERT porque en las bases que ya existen la fila
-- esta creada por schema.sql con el hash roto: un ON CONFLICT DO NOTHING la
-- dejaria intacta y el problema seguiria igual.
INSERT INTO users (email, password, role, is_active, team_id)
VALUES ('admin@humanfirewall.com',
        '$2b$10$EbCWsrs.jRUKjOgTlroFSOfxgvQOEWrzJMYlWjE/qXywM4kM1aqNG',
        'admin', true, 1)
ON CONFLICT (email) DO UPDATE
   SET password  = EXCLUDED.password,
       role      = 'admin',
       is_active = true;

-- Recursos Humanos: el rol que abre /reports.
INSERT INTO users (email, password, role, is_active, team_id)
VALUES ('rh@humanfirewall.com',
        '$2b$10$ImXydqCcTlU1pxMaoB6Ek.ckLVnDrQHtt4PXzKkHkq1.j6He0nLvC',
        'rh', true, 4)
ON CONFLICT (email) DO UPDATE
   SET password  = EXCLUDED.password,
       role      = 'rh',
       is_active = true;
