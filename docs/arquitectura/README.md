# Arquitectura de Human Firewall: microservicios por capas

Este documento explica como esta organizado el backend, por que, y que reglas
hay que respetar al cambiarlo. El detalle de cada servicio (endpoints,
tablas, eventos, archivos) esta en [`SERVICIOS.md`](SERVICIOS.md), que se
genera desde el codigo. El contrato de la API se navega en `/api/docs`.

---

## 1. Tres decisiones que conviven

Human Firewall tomo tres decisiones de arquitectura en tres historias
distintas. No se reemplazan entre si: cada una responde una pregunta
diferente.

| Pregunta | Decision | Desde |
|----------|----------|-------|
| Como se **despliega**? | Monolito: un proceso Express sirve la API y el build de React, en `:3000`, contra una sola base. | HU de arquitectura monolitica |
| Como se **avisan** los modulos que algo paso? | Eventos con patron outbox: el que provoca el hecho publica y responde; los interesados reaccionan despues. | HU de arquitectura basada en eventos |
| Como se **organiza** el codigo? | Microservicios logicos por capas: siete servicios con limites, datos y contratos propios, cada uno con capas internas. | Esta HU |

El resultado es un **monolito modular orientado a servicios**: los siete
servicios viajan en el mismo despliegue, pero cada uno tiene la forma, los
limites y los contratos que tendria si manana se desplegara aparte. Se eligio
asi (y no un proceso por servicio) porque la HU pide no reescribir de mas ni
hacer migraciones innecesarias, y para el volumen de la plataforma un
despliegue distribuido solo agrega latencia de red, fallos parciales y
coordinacion de despliegues.

```
                         Navegador (React)
                                |
                                |  HTTP + JWT   (contrato publico: /api/docs)
                                v
  +------------------------------------------------------------------------+
  |  Proceso Express :3000                                                  |
  |                                                                        |
  |  compartido/   traceId -> json -> passport -> [rutas de cada servicio]  |
  |                -> 404 JSON -> manejador de errores comun               |
  |                                                                        |
  |  +-----------+  +--------+  +-------------+  +--------------+          |
  |  | identidad |  | cursos |  | evaluaciones|  | gamificacion |          |
  |  +-----------+  +--------+  +-------------+  +--------------+          |
  |  +----------------+  +----------+  +-----------+                       |
  |  | notificaciones |  | reportes |  | seguridad |                       |
  |  +----------------+  +----------+  +-----------+                       |
  |        |   contrato interno (index.js)   |   eventos (event_outbox)    |
  +--------|---------------------------------|-----------------------------+
           v                                 v
                         PostgreSQL (un esquema, un dueno por tabla)
```

---

## 2. Los servicios

| Servicio | De que es responsable |
|----------|-----------------------|
| `identidad` | Cuentas, login (correo/contrasena y Google), recuperacion de contrasena, roles, perfil, equipos e invitaciones |
| `cursos` | Cursos, lecciones, asignaciones, progreso, cierre del curso y aviso de fechas limite |
| `evaluaciones` | Simulaciones, desafios del portal e historial de intentos, con el puntaje calculado en el servidor |
| `gamificacion` | Puntos, recompensas, niveles, ranking y recomendaciones de refuerzo |
| `notificaciones` | Bandeja in-app, notificacion de resultados, preferencias y cola de correo |
| `reportes` | Reporte de desempeno para RH, reportes programados y consolidado organizacional |
| `seguridad` | Deteccion de anomalias, auditoria de ajustes manuales y registro de acciones criticas (`data.logs`) |

Los limites salieron de las responsabilidades que el proyecto ya tenia (cada
HU agrego su modulo), no de un diseno nuevo. Lo que cambio es que ahora cada
limite es explicito y verificable:

- Un servicio es **dueno** de sus tablas (ver `manifiesto.js`).
- Un servicio es el **unico que publica** sus eventos.
- Un servicio solo llega a otro por su **contrato interno**.

Quien depende de quien (por contrato interno):

```
evaluaciones ---> cursos
     |
     v
gamificacion ---> cursos, evaluaciones, identidad, seguridad
     ^
     |
reportes -------> gamificacion, notificaciones, seguridad
seguridad ------> gamificacion, identidad
notificaciones -> identidad, cursos, evaluaciones
identidad ------> seguridad, notificaciones
```

Hay dependencias en las dos direcciones entre algunos pares (por ejemplo
gamificacion -> seguridad para registrar un ajuste, y seguridad ->
gamificacion para aplicarlo). Es legitimo porque cada una es una pregunta
distinta, y no genera ciclos de carga porque los clientes resuelven el otro
servicio al llamar, no al importar.

---

## 3. Estructura de carpetas (seccion 11 del material)

La organizacion sigue la seccion **11. Arquitectura de microservicios
aplicando capas** del material del curso: cada microservicio tiene sus propias
capas Controller, Application, Domain, Infrastructure y Persistence, su propia
configuracion y su propia puerta de entrada.

### El ejemplo del material y su equivalente aca

El material lo muestra con un `product-service`. Este es el mismo arbol
aplicado a uno de nuestros servicios, **cursos**:

```
product-service/                         cursos/
|-- controller/                          |-- controller/
|   `-- ProductController                |   |-- course.routes.js        rutas + middlewares
|                                        |   |-- course.controller.js    HTTP -> caso de uso
|                                        |   `-- dto.js                  DTO de entrada (JSON Schema)
|-- application/                         |-- application/
|   `-- ProductService                   |   `-- cursos.service.js       casos de uso
|-- domain/                              |-- domain/
|   `-- Product                          |   `-- curso.js                reglas: crearCurso, fechaLimite, ...
|-- infrastructure/                      |-- infrastructure/
|   |-- persistence/                     |   `-- persistence/
|   |   `-- ProductRepository            |       `-- cursos.repositorio.js   SQL de sus propias tablas
|   `-- client/                          |
|       `-- InventoryClient              |   (evaluaciones/infrastructure/client/cursos.cliente.js
|                                        |    es el "InventoryClient" de este servicio)
|-- config/                              |-- config/
|   `-- application.yml                  |   `-- configuracion.js        variables del servicio
`-- ProductApplication                   |-- index.js                    puerta de entrada del servicio
                                         |-- manifiesto.js              ficha: tablas, eventos, dependencias
                                         `-- contract/openapi.js        contrato de su API
```

| Capa del material | Carpeta en cada servicio | Que hace |
|---|---|---|
| Controller / API | `controller/` | Recibe el HTTP, valida el DTO, delega en application y devuelve la respuesta |
| Application / Service | `application/` | Coordina los casos de uso: pasos, transaccion, eventos, llamadas a otros servicios |
| Domain | `domain/` | Reglas y entidades del negocio, como funciones puras (sin base, sin HTTP) |
| Infrastructure | `infrastructure/client/` | Clientes para hablar con otros microservicios (por su contrato `index.js`) |
| Persistence | `infrastructure/persistence/` | Repositorios: el SQL de los datos propios del servicio |
| Configuracion (`application.yml`) | `config/configuracion.js` | Las variables de entorno del servicio, con sus valores por defecto |
| `ProductApplication` | `index.js` | Punto de entrada: lo unico que otro servicio puede usar |

Los siete servicios (identidad, cursos, evaluaciones, gamificacion,
notificaciones, reportes y seguridad) tienen las mismas carpetas. El detalle
archivo por archivo esta en [`SERVICIOS.md`](SERVICIOS.md).

### El arbol completo

```
human-firewall-backend/src/
|-- app.js                  Compone la aplicacion: monta las rutas de cada servicio,
|                           /api/docs, el 404 JSON y el manejador de errores
|-- server.js               Arranque: valida el entorno, conecta el bus, escucha el puerto
|
|-- compartido/             Plataforma transversal. NO depende de ningun servicio.
|   |-- config/             db.js (pool), transaccion.js, entorno.js, rutas.js, migrate.js
|   |-- eventos/            eventBus.js (outbox + worker) y catalogo.js (nombres y payloads)
|   |-- http/               errores.js (formato comun) y validacion.js (DTO con JSON Schema)
|   |-- middlewares/        verifyToken, requireRoles, selfOrRoles, rate limit, traceId
|   |-- contratos/          arma el OpenAPI de todos los servicios y sirve /api/docs
|   |-- arquitectura/       analizador estatico que usan las pruebas de arquitectura
|   `-- utils/              hash, token, csv, correo
|
`-- servicios/
    |-- index.js            Registro: la lista de servicios
    |-- suscriptores.js     Conecta los servicios al bus de eventos
    `-- <servicio>/
        |-- controller/                 Controller / API
        |-- application/                Application / Service
        |-- domain/                     Domain
        |-- infrastructure/
        |   |-- persistence/            Persistence (repositorios)
        |   `-- client/                 Un cliente por cada servicio del que depende
        |-- config/configuracion.js     Configuracion del servicio
        |-- contract/openapi.js         Contrato OpenAPI de su API publica
        |-- index.js                    Puerta publica (contrato interno)
        |-- manifiesto.js               Ficha: responsabilidad, prefijos, tablas, eventos
        `-- README.md                   Donde hacer cada tipo de cambio en este servicio
```

### Que va en cada capa

| Capa | Que va aca | Que NO va aca |
|------|-----------|---------------|
| **controller/** | `*.routes.js`: ruta + cadena de middlewares (token -> rol -> DTO -> controlador). `*.controller.js`: traduce HTTP a una llamada de application y el resultado a una respuesta. `dto.js`: los DTO. | SQL, reglas de negocio, repositorios, llamadas a otros servicios (salvo el registro de auditoria) |
| **application/** | Casos de uso: que pasos tiene una operacion, que va en transaccion, que evento se publica, a que otro servicio se le pregunta algo | HTTP (`req`, `res`) |
| **domain/** | Reglas puras: funciones que reciben datos y devuelven un resultado (`crearCurso`, `calcularProgreso`, `calcularVariacion`, `enmascarar`...) | Base de datos, bus, HTTP, cualquier `require` fuera del dominio |
| **infrastructure/persistence/** | Repositorios: el SQL | Reglas de negocio |
| **infrastructure/client/** | Clientes de otros servicios, integraciones (Google) | Reglas de negocio |
| **config/** | Las variables de entorno del servicio y sus valores por defecto | Secretos escritos en el codigo |
| **contract/** | El OpenAPI de la API publica del servicio | Logica |

Ningun controlador tiene SQL ni usa un repositorio: todos pasan por
`application/`. En identidad y cursos todo el SQL ya esta en
`infrastructure/persistence/`. En los servicios de aplicacion mas grandes
(puntos, recompensas, notificaciones, reportes, seguridad) parte del SQL sigue
dentro del servicio de aplicacion; moverlo a repositorios es el paso
siguiente. La regla para el codigo nuevo es: **el SQL nuevo va en un
repositorio de `infrastructure/persistence/`.**

---

## 4. Reglas de dependencia

Estas reglas las verifica `tests/arquitectura.test.mjs` en cada `npm test`. Si
alguien las rompe, la prueba dice en que archivo.

1. **Ningun controlador ni archivo de rutas importa la base** ni tiene SQL,
   y no usa repositorios ni otros servicios: delega en `application/`.
2. **El dominio no importa nada fuera del dominio** y no tiene SQL.
3. **Cada servicio tiene controller, application, domain, infrastructure y
   `config/configuracion.js`**, y las variables de entorno se leen solo en su
   `config/` (o en `compartido/config`).
4. **Un servicio llega a otro solo por su `index.js`, y solo desde
   `infrastructure/client/<otro>.cliente.js`.** Nada de
   `require('../../gamificacion/application/points.service')`.
5. **`dependeDe` del manifiesto coincide con los clientes reales.**
6. **Los clientes resuelven el otro servicio al llamar** (`const x = () => require(...)`),
   para que dos servicios que se usan mutuamente no generen un ciclo de carga.
7. **`compartido/` no depende de ningun servicio.** Lo que necesita de ellos
   (sus rutas, sus contratos) se lo pasa quien compone: `app.js`.
8. **Cada tabla tiene un solo dueno**, nadie escribe en tablas ajenas sin
   declararlo, y toda lectura de una tabla ajena esta declarada con su motivo.
9. **Los eventos que declara cada manifiesto son los que el codigo publica y
   consume**, y cada evento lo publica un solo servicio.

---

## 5. Comunicacion

Hay tres mecanismos, y cada uno tiene su lugar:

| Mecanismo | Cuando | Ejemplo |
|-----------|--------|---------|
| **HTTP publico** (contrato OpenAPI) | El frontend, o cualquier cliente externo, le pide algo al backend | `POST /api/courses/assign` |
| **Contrato interno** (`index.js` via un cliente) | Un servicio necesita una respuesta *ahora* para completar su propio caso de uso: una consulta, o un comando que debe quedar hecho antes de responder | evaluaciones pregunta a cursos que cursos tiene asignados el usuario; seguridad le pide a gamificacion que aplique un ajuste manual |
| **Eventos** (outbox) | Algo ya paso y otros servicios tienen que reaccionar, sin que quien lo provoco espere | cursos publica `lesson.completed`; gamificacion asigna los puntos; notificaciones avisa |

Regla practica: si el que llama **necesita el resultado para responder**, es
contrato interno. Si el que llama **solo esta contando que algo paso**, es un
evento.

### Por que el contrato interno pasa por un cliente

```
evaluaciones/application/simulaciones.service.js
        |
        v
evaluaciones/infrastructure/client/cursos.cliente.js   <-- unico punto de contacto
        |
        v
cursos/index.js                                         <-- puerta publica de cursos
        |
        v
cursos/application/cursos.service.js -> cursos/infrastructure/persistence/cursos.repositorio.js
```

Hoy el cliente es una llamada de funcion en el mismo proceso. Si manana
`cursos` se desplegara aparte, solo cambia el cliente (pasaria a hacer
`fetch` a una API interna, con timeout y reintentos) y el resto de
evaluaciones no se entera. Es el mismo papel que cumple un `InventoryClient`
con Feign en el ejemplo de clase.

### Rutas que comparten prefijo

Por compatibilidad con el frontend, varias rutas conservan el prefijo
`/api/gamification` aunque las atienda otro servicio:

| Prefijo | Servicio |
|---------|----------|
| `/api/gamification` (resto) | gamificacion |
| `/api/gamification/challenge` | evaluaciones |
| `/api/gamification/reports/*` | reportes |
| `/api/gamification/security/*`, `/api/gamification/users/*` | seguridad |

Cada servicio monta su propio router; ninguna URL cambio.

---

## 6. Datos

Todos los servicios comparten una base PostgreSQL (es un solo despliegue),
pero cada tabla tiene **un dueno**: el unico servicio que la escribe y el
que decide su forma. La lista esta en el `manifiesto.js` de cada servicio y en
[`SERVICIOS.md`](SERVICIOS.md).

Cuando esta HU empezo habia servicios escribiendo en tablas ajenas. Se
corrigieron:

| Antes | Ahora |
|-------|-------|
| notificaciones hacia `UPDATE courses SET is_critical` | lo hace cursos (`marcarCritico`) por su contrato |
| notificaciones hacia `UPDATE course_assignments SET deadline_notified_at` | el reloj de fechas limite paso a cursos, que publica `course.deadline_approaching` |
| gamificacion escribia `user_challenge_results` y `quiz_attempts` (POST /challenge) | el desafio lo registra evaluaciones |

Y lecturas puntuales de tablas ajenas pasaron a ser llamadas al dueno: el
titulo de un curso, el correo y el idioma de un usuario, los RH de su equipo,
los conteos que usan las recompensas, la existencia de un usuario.

Quedan **excepciones declaradas**, cada una con su motivo en el manifiesto:

- **Escritura:** `users.total_points` y `users.level`, cache que mantiene
  gamificacion (la fuente de verdad es `points_ledger`).
- **Lecturas analiticas:** reportes agrega datos de varios servicios en SQL;
  gamificacion arma el resumen de desempeno con un JOIN a intentos y cursos;
  seguridad analiza ventanas de `points_ledger` y muestra correos con un JOIN.

Son lecturas, nunca escrituras, y la prueba de arquitectura impide que
aparezca una nueva sin declararla. Si algun dia se separa la base, cada una
se reemplaza por una proyeccion propia alimentada por eventos.

---

## 7. Contratos de API

### Donde estan

- `GET /api/docs` — Swagger UI, para leer y probar la API.
- `GET /api/docs/openapi.json` — el contrato OpenAPI 3.1 (se importa en
  Postman con *Import > Link*).
- `servicios/<servicio>/contrato/openapi.js` — el contrato de cada servicio.

Cada operacion documenta metodo, ruta, acceso (`security` + `x-roles` y, si
aplica, `x-propietario`), parametros, cuerpo, respuestas con su esquema y
errores. Esta encendido por defecto; con `NODE_ENV=production` se apaga salvo
que `API_DOCS=true`.

### Una sola fuente de verdad para la entrada

El cuerpo y los parametros de cada operacion son **el mismo objeto** que
valida la ruta (`controller/dto.js`). No se escriben dos veces, asi que no se
pueden desalinear. `x-validacion` dice quien valida: `middleware` (el DTO,
antes del controlador) o `servicio` (endpoints que ya validaban dentro del
servicio con mensajes por campo que la pantalla muestra; se publica el
esquema pero no se valida dos veces).

### Convenciones de respuesta

**Exito:** el recurso o la lista directamente, con el status que corresponde
(`200` lectura o accion, `201` creacion, `202` aceptado para proceso en
segundo plano). Los listados paginados traen `paginacion` con `page`,
`page_size`, `total` y `total_paginas`.

**Error:** siempre el mismo formato:

```json
{
  "msg": "Parametros invalidos",
  "codigo": "VALIDACION",
  "errores": [{ "campo": "title", "detalle": "Es obligatorio." }],
  "traceId": "solo en 500"
}
```

| Status | `codigo` | Cuando |
|--------|----------|--------|
| 400 | `VALIDACION` | DTO invalido, parametro con formato invalido, regla de negocio violada por los datos |
| 400 | `JSON_INVALIDO` | el cuerpo no es JSON |
| 401 | `NO_AUTENTICADO` | sin token, token invalido o vencido, credenciales incorrectas |
| 403 | `PROHIBIDO` | token valido pero rol insuficiente (se responde sin consultar la base) |
| 404 | `NO_ENCONTRADO` | el recurso o el endpoint no existe |
| 409 | `CONFLICTO` | el recurso ya existe o esta en un estado que no lo permite |
| 429 | — | limite de solicitudes por IP (login, invitaciones) |
| 500 | `ERROR_INTERNO` | cualquier error inesperado |

`msg` se conservo con ese nombre porque el frontend ya lo lee en todas las
pantallas. Un **500 nunca devuelve el mensaje interno** (antes 68 respuestas
devolvian `error.message`, con el texto crudo de PostgreSQL): el detalle se
escribe en el log del servidor junto al `traceId`, y la respuesta trae solo el
`traceId` para encontrarlo. El mismo valor vuelve en el encabezado
`X-Trace-Id`.

Los cambios a un contrato siguen [`docs/contratos/POLITICA.md`](../contratos/POLITICA.md)
y quedan en [`docs/contratos/CHANGELOG.md`](../contratos/CHANGELOG.md).

---

## 8. Seguridad

Se reutilizaron los mecanismos que ya existian; esta HU los hizo explicitos
en el contrato y verificables:

- **Autenticacion:** JWT con `{ id, role }` (`verifyToken`). El rol viaja en
  el token: cambiar el rol en la base no surte efecto hasta que el token vence.
- **Autorizacion:** `verifyToken(roles)`, `requireRoles(roles)` y
  `selfOrRoles(roles, param)` (el propio usuario o ciertos roles). Siempre en
  la ruta, antes del controlador: un 403 no ejecuta ninguna consulta.
- **Contrato:** cada operacion declara su acceso (`security`, `x-roles`,
  `x-propietario`) y la prueba de contrato compara eso con los middlewares
  reales de la ruta.
- **Limite por IP** en login y en las rutas publicas de invitaciones.
- **Trazabilidad:** `X-Trace-Id` por request; las acciones criticas quedan en
  `data.logs` con IP y trace_id, y los valores sensibles enmascarados.

## 9. Configuracion y secretos

- Cada servicio tiene su `config/configuracion.js` (el `application.yml` del
  material): ahi estan todas las variables que usa, con su valor por defecto.
  El resto del servicio pide `config.smtp.host`, no `process.env.SMTP_HOST`.
- Las variables se leen con `compartido/config/entorno.js`. Las obligatorias
  (`DATABASE_URL`, `JWT_SECRET`) no tienen valor por defecto: sin ellas el
  servidor no arranca y dice cual falta. Antes `JWT_SECRET` caia a la cadena
  `'secret'`, con la que cualquiera podia firmarse un token de admin.
- `npm run setup` genera el `.env` con un `JWT_SECRET` aleatorio. Todas las
  variables estan documentadas en `.env.example`.
- `seed_admin.js` ya no tiene el correo y la contrasena escritos: los lee de
  `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
- Pendiente (no se toca porque una migracion mergeada no se edita): la
  migracion 027 siembra cuentas de desarrollo con contrasenas conocidas. En un
  entorno real hay que cambiarlas despues de migrar.

---

## 10. Pruebas

| Suite | Que verifica |
|-------|--------------|
| `unitarias.test.mjs` | La logica aislada en su capa: reglas de puntaje, politica de contrasenas, formato de errores, validacion por DTO, constructor de contratos. Sin base ni servidor. |
| `arquitectura.test.mjs` | Las reglas de la seccion 4, la veracidad de los manifiestos y que `SERVICIOS.md` este al dia |
| `contratos.test.mjs` | Que cada ruta real este documentada y al reves, que seguridad y validacion documentadas sean las que se aplican, que ~100 respuestas reales (exitos y errores) cumplan los esquemas, y que los errores tengan el formato comun sin filtrar detalles internos |
| las 15 suites anteriores | Integracion por HU, contra PostgreSQL real (PGlite) |

```bash
cd human-firewall-backend
npm test                  # todo
npm run test:contratos    # una suite
```

---

## 11. Como agregar una funcionalidad

1. **Ubicarla.** Busca en [`SERVICIOS.md`](SERVICIOS.md) que servicio es dueno
   de los datos que toca. Ese es el servicio. Si toca datos de dos, el caso de
   uso va en el que *decide*, y el otro se consulta por su contrato o
   reacciona por un evento.
2. **Entrada.** Define el DTO en `controller/dto.js`.
3. **Ruta.** En `controller/<x>.routes.js`: `verifyToken(...)`, rol si aplica,
   `validar(esquemas.loNuevo)`, controlador.
4. **Controlador.** Delgado: toma `req`, llama a la capa de aplicacion,
   responde. Los errores van a `responderError(req, res, error)`.
5. **Caso de uso.** En `application/`. Errores del cliente como `ErrorHttp`
   (404, 409, 400). Si publica un evento, el evento va al catalogo y al
   `publica` del manifiesto.
6. **SQL.** En un repositorio de `infrastructure/`, solo sobre tablas propias.
   Si necesitas un dato de otro servicio, agrega una funcion a su `index.js`
   y usala desde tu cliente.
7. **Contrato.** Agrega la operacion en `contract/openapi.js` (con
   `operacion({...})`, reutilizando el DTO). La prueba de contrato falla si
   te olvidas.
8. **Documentacion.** `npm run docs:arquitectura` y, si cambia un contrato
   existente, una entrada en el CHANGELOG de contratos.
9. **Pruebas.** `npm test`.

### Como agregar un servicio nuevo

Crear `servicios/<nuevo>/` con la misma forma (copiar la de `cursos`, que es
la mas simple), agregarlo a `servicios/index.js` y declarar sus tablas en el
manifiesto. Las pruebas de arquitectura y de contrato lo incorporan solas.

---

## 12. Si algun servicio se despliega aparte

La organizacion actual deja el camino preparado. Para extraer, por ejemplo,
notificaciones a su propio proceso:

1. Su `index.js` pasa a ser una API interna (HTTP) y los clientes que lo usan
   (`identidad`, `reportes`) cambian su implementacion a `fetch`.
2. Los eventos que consume dejan de leerse del outbox local y pasan por un
   broker (RabbitMQ, SNS/SQS); el patron outbox se mantiene del lado de quien
   publica.
3. Sus tablas pasan a su propia base; sus lecturas de tablas ajenas ya son
   llamadas por contrato, asi que no hay JOINs que romper.
4. El contrato publico (`contract/openapi.js`) no cambia; delante de los
   servicios va un API Gateway que enruta por prefijo, la tabla de la seccion 5.

Reportes es el servicio mas lejos de poder extraerse, por sus lecturas
analiticas; seria el ultimo, o se alimentaria de una replica.
