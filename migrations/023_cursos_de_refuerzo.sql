-- =====================================================================
-- 023_cursos_de_refuerzo.sql
-- HU: Recomendaciones e indicadores para mejorar el desempeno.
--
-- El motor de recomendaciones sugiere lecciones "del mismo curso" que la
-- evaluacion que salio mal. Ese enlace se resuelve por challenges.course_id,
-- pero los cinco desafios del portal se sembraron con course_id NULL y la
-- base no traia ningun curso: al fallar, el sistema detectaba el area de
-- oportunidad y no tenia una sola leccion que ofrecer.
--
-- Esta migracion crea un curso por cada tema de desafio, con tres lecciones
-- de refuerzo, y enlaza cada desafio con el suyo.
--
-- Los ids van en el rango 900+ para no chocar con los cursos que carguen los
-- instructores desde el panel, que usan la secuencia normal.
--
-- Depende de: 003_lesson_quiz_tracking.sql (challenges.course_id)
--             008_desafios_faltantes.sql   (los cinco desafios)
-- =====================================================================

INSERT INTO courses (id, title, description) VALUES
    (901, 'Deteccion de Phishing',
          'Como reconocer un correo fraudulento antes de hacer clic.'),
    (902, 'Contrasenas Seguras',
          'Que hace fuerte a una contrasena y como gestionarlas sin sufrir.'),
    (903, 'Redes Wi-Fi Seguras',
          'Riesgos de las redes publicas y como trabajar fuera de la oficina.'),
    (904, 'Ingenieria Social',
          'Manipulacion psicologica: urgencia, autoridad y confidencialidad.'),
    (905, 'Proteccion de Datos y Ransomware',
          'Que hacer antes, durante y despues de un secuestro de datos.')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Lecciones
-- ---------------------------------------------------------------------
-- points_reward alimenta la regla lesson.completed del servicio de puntos:
-- completar una leccion de refuerzo suma, que es justamente el incentivo
-- para hacerle caso a la recomendacion.

INSERT INTO course_contents (id, course_id, content_type, body, order_idx, points_reward) VALUES
    -- Phishing
    (9011, 901, 'text',  'El remitente: por que "hr-empresa-updates@admin-portal-login.com" no es tu area de RR.HH. Como leer un dominio de derecha a izquierda.', 1, 20),
    (9012, 901, 'text',  'La urgencia como arma: "tienes 24 horas o pierdes el bono". Ningun proceso legitimo de la empresa te apura asi.', 2, 20),
    (9013, 901, 'video', 'Adjuntos y doble extension: por que Formulario.pdf.exe no es un PDF.', 3, 25),

    -- Contrasenas
    (9021, 902, 'text',  'Longitud antes que complejidad: por que una frase larga resiste mas que ocho caracteres raros.', 1, 20),
    (9022, 902, 'text',  'Reutilizar una contrasena es regalar todas: como un filtrado en un sitio cualquiera termina en el correo corporativo.', 2, 20),
    (9023, 902, 'video', 'Gestores de contrasenas y segundo factor: dos habitos que cubren casi todo.', 3, 25),

    -- Wi-Fi
    (9031, 903, 'text',  'Redes abiertas: que puede ver un tercero cuando no hay cifrado entre tu equipo y el punto de acceso.', 1, 20),
    (9032, 903, 'text',  'Evil Twin: como se monta una red con el nombre del local para que te conectes solo.', 2, 20),
    (9033, 903, 'video', 'Alternativas seguras: datos del celular, VPN corporativa y que hacer si no hay ninguna.', 3, 25),

    -- Ingenieria social
    (9041, 904, 'text',  'Fraude del CEO: la combinacion de autoridad, urgencia y secreto que desactiva el pensamiento critico.', 1, 25),
    (9042, 904, 'text',  'Verificacion por canal alternativo: por que se confirma llamando a un numero conocido, nunca respondiendo el mismo mensaje.', 2, 25),
    (9043, 904, 'video', 'Pretexting y suplantacion: casos reales de soporte tecnico falso.', 3, 25),

    -- Ransomware
    (9051, 905, 'text',  'Software pirata como vector: el instalador con crack es el disfraz mas comun del ransomware.', 1, 20),
    (9052, 905, 'text',  'Primeros 60 segundos: desconectar de la red antes que apagar, y por que ese orden importa.', 2, 25),
    (9053, 905, 'text',  'Por que nunca se paga: no hay garantia de recuperar nada y te marca como objetivo rentable.', 3, 25)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Enlace desafio -> curso
-- ---------------------------------------------------------------------
-- Sin esto no hay recomendacion posible: es la unica forma que tiene el motor
-- de saber que leccion ofrecer ante una evaluacion floja.
UPDATE challenges SET course_id = 901 WHERE id = 'phishing' AND course_id IS NULL;
UPDATE challenges SET course_id = 902 WHERE id = 'password' AND course_id IS NULL;
UPDATE challenges SET course_id = 903 WHERE id = 'wifi'     AND course_id IS NULL;
UPDATE challenges SET course_id = 904 WHERE id = 'social'   AND course_id IS NULL;
UPDATE challenges SET course_id = 905 WHERE id = 'data'     AND course_id IS NULL;

-- Los intentos ya registrados quedaron con course_id NULL porque en ese
-- momento el desafio no pertenecia a ningun curso. Se completan hacia atras
-- para que el historial existente tambien genere recomendaciones.
UPDATE quiz_attempts qa
   SET course_id = ch.course_id
  FROM challenges ch
 WHERE qa.quiz_type = 'challenge'
   AND qa.quiz_ref = ch.id
   AND qa.course_id IS NULL
   AND ch.course_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Asignacion
-- ---------------------------------------------------------------------
-- Los cinco desafios del portal estan abiertos a todo el mundo, asi que sus
-- cursos de refuerzo tambien se asignan a todos los usuarios existentes. Sin
-- la asignacion, el panel "Avance en tus cursos" quedaria vacio.
--
-- Los usuarios que se registren despues de esta migracion no quedan asignados
-- automaticamente: eso lo decide el area de capacitacion desde el panel, como
-- pide la regla de negocio RN-01. Las recomendaciones igual les funcionan,
-- porque no dependen de la asignacion sino del curso de la evaluacion.
INSERT INTO course_assignments (course_id, user_id, status)
SELECT c.id, u.id, 'assigned'
  FROM courses c
 CROSS JOIN users u
 WHERE c.id BETWEEN 901 AND 905
ON CONFLICT (course_id, user_id) DO NOTHING;

-- Las secuencias siguen en su numeracion normal; los ids 900+ se insertaron a
-- mano y no las movieron. Si un instructor crea un curso ahora, tomaria un id
-- bajo que podria chocar. Se adelantan por las dudas.
SELECT setval('courses_id_seq',          GREATEST((SELECT MAX(id) FROM courses), 1000));
SELECT setval('course_contents_id_seq',  GREATEST((SELECT MAX(id) FROM course_contents), 10000));
