-- =====================================================================
-- 036_perfil_editable.sql
-- HU: "Yo como empleado quiero consultar y actualizar la informacion
-- personal que tengo registrada en mi perfil de Human Firewall, modificando
-- unicamente los campos que esten habilitados para edicion."
--
-- Que agrega y por que:
--
--   users.phone  -> telefono de contacto, el dato de contacto que el empleado
--                   puede mantener por su cuenta (criterio tecnico 3)
--
-- Los demas campos editables ya existian: users.full_name (035) y
-- users.language (034). El correo NO es editable: es el usuario de login, y
-- cambiarlo exige verificar el nuevo, que queda fuera de esta HU.
--
-- Depende de: schema.sql (users), 035_invitaciones.sql (users.full_name)
-- =====================================================================

-- Se guarda normalizado: un '+' opcional y solo digitos, entre 7 y 15 (el
-- largo maximo de un numero E.164). Los espacios, guiones y parentesis que
-- escribe la persona los quita el servicio antes de guardar.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone VARCHAR(16);

-- El CHECK es la ultima barrera: la validacion real (con el mensaje para la
-- pantalla) esta en dominio/usuario.js. Si algo se saltea el servicio, la
-- base igual no guarda un telefono con letras.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_formato'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_phone_formato
            CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$');
    END IF;
END $$;
