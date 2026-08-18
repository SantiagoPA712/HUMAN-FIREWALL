-- =====================================================================
-- 024_simulacion_de_ejemplo.sql
--
-- El sistema tenia toda la maquinaria de simulaciones guiadas (simulations,
-- simulation_steps, simulation_options, y los endpoints para crearlas y
-- jugarlas) pero ninguna fila cargada y ninguna pantalla que las mostrara.
-- Los cinco "desafios" del portal son minijuegos escritos a mano en React que
-- ni siquiera pasan por estas tablas.
--
-- Esta migracion carga una simulacion completa para que la funcionalidad sea
-- visible y demostrable: tres pasos, cada uno con tres opciones, con
-- retroalimentacion escrita para cada eleccion.
--
-- A diferencia de los minijuegos, esta simulacion es contenido de base de
-- datos: un instructor puede crear otras desde la API sin tocar el codigo,
-- que era el objetivo del diseno original.
--
-- Depende de: 003_lesson_quiz_tracking.sql (simulations.course_id)
--             023_cursos_de_refuerzo.sql   (el curso 901)
-- =====================================================================

INSERT INTO simulations (id, title, description, difficulty, course_id) VALUES
    (910,
     'Correo del proveedor con factura adjunta',
     'Recibis la factura mensual de un proveedor habitual. Algo no cierra. Tres decisiones, una cadena de consecuencias.',
     'intermediate',
     901)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Pasos
-- ---------------------------------------------------------------------
INSERT INTO simulation_steps (id, simulation_id, scenario_text, order_idx) VALUES
    (9101, 910,
     'Llega un correo de "Facturacion - Insumos del Norte", tu proveedor de siempre. El asunto dice "Factura 4471 - VENCIDA". El remitente es facturacion@insumos-delnorte.com, pero vos recordabas el dominio como insumosdelnorte.com, sin guion. El cuerpo pide pagar hoy a una cuenta nueva. Que haces primero?',
     1),
    (9102, 910,
     'Decidis mirar el adjunto antes de actuar. El archivo se llama Factura_4471.pdf y pesa 38 KB, pero al pasar el mouse por encima el navegador muestra que en realidad termina en .html. Que haces?',
     2),
    (9103, 910,
     'Confirmas que es un intento de fraude. El correo ya circulo por varias casillas del area de compras. Cual es la accion mas util ahora?',
     3)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Opciones
-- ---------------------------------------------------------------------
-- points_awarded define el puntaje: el endpoint /complete calcula el
-- porcentaje contra la mejor opcion de cada paso, asi que la correcta de cada
-- paso marca el techo.
--
-- Las opciones intermedias otorgan puntaje parcial a proposito: "no hacer
-- nada" es menos danino que pagar, pero tampoco es la respuesta correcta.

INSERT INTO simulation_options (id, step_id, option_text, is_correct, points_awarded, feedback_text) VALUES
    -- Paso 1
    (91011, 9101, 'Pagar de inmediato: es un proveedor conocido y la factura figura vencida.',
     false, 0,
     'El cambio de cuenta bancaria es la senal numero uno del fraude de factura. La urgencia esta puesta ahi justamente para que no verifiques.'),
    (91012, 9101, 'Responder el correo preguntando si el cambio de cuenta es correcto.',
     false, 10,
     'Mejor que pagar, pero si el correo es del atacante te va a responder que si. La verificacion nunca se hace por el mismo canal.'),
    (91013, 9101, 'Llamar al proveedor al telefono que ya tenias registrado y confirmar el cambio de cuenta.',
     true, 40,
     'Correcto. Verificacion por canal alternativo, usando un contacto que ya tenias y no uno que aparece en el correo sospechoso.'),

    -- Paso 2
    (91021, 9102, 'Abrirlo igual: un PDF no puede hacer dano.',
     false, 0,
     'No es un PDF. La doble extension es el disfraz clasico: lo que se abre es una pagina que imita el login corporativo para robar tus credenciales.'),
    (91022, 9102, 'Guardarlo en el escritorio para revisarlo mas tarde con calma.',
     false, 10,
     'Sigue estando en tu equipo. Un archivo sospechoso no se guarda: se reporta y se elimina.'),
    (91023, 9102, 'No abrirlo y reportar el correo al area de seguridad con el adjunto sin tocar.',
     true, 30,
     'Correcto. Seguridad necesita el original para rastrear la campana, y vos no corres el riesgo de ejecutarlo.'),

    -- Paso 3
    (91031, 9103, 'Borrar el correo de tu casilla y seguir trabajando.',
     false, 0,
     'Tu casilla queda limpia, pero tus companeros siguen expuestos. El incidente no termina cuando vos estas a salvo.'),
    (91032, 9103, 'Avisar por chat a los companeros mas cercanos.',
     false, 15,
     'Ayuda, pero llega solo a algunos y sin trazabilidad. El aviso tiene que ser formal para que quede registro.'),
    (91033, 9103, 'Reportar al area de seguridad indicando que el correo llego a varias casillas de compras.',
     true, 30,
     'Correcto. Con ese dato seguridad puede bloquear el dominio, buscar quien mas lo recibio y avisar al proveedor real de que estan suplantando su identidad.')
ON CONFLICT (id) DO NOTHING;

-- Las secuencias siguen en su numeracion normal y los ids 9000+ se insertaron
-- a mano. Se adelantan para que una simulacion creada desde el panel no tome
-- un id que ya existe.
SELECT setval('simulations_id_seq',        GREATEST((SELECT MAX(id) FROM simulations), 1000));
SELECT setval('simulation_steps_id_seq',   GREATEST((SELECT MAX(id) FROM simulation_steps), 10000));
SELECT setval('simulation_options_id_seq', GREATEST((SELECT MAX(id) FROM simulation_options), 100000));
