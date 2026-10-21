# Politica de cambios de contratos de API

Un contrato es una promesa a quien consume la API: hoy el frontend
(`human-firewall-frontend/src/lib/api.js` y las paginas), manana quizas otro
cliente o un servicio desplegado aparte. Esta politica dice como cambiarlo
sin romper a nadie.

Aplica a dos tipos de contrato:

- **Publico:** la API HTTP, documentada en `servicios/<servicio>/contrato/openapi.js`
  y servida en `/api/docs`.
- **Interno:** lo que expone el `index.js` de cada servicio a los demas, y el
  catalogo de eventos (`compartido/eventos/catalogo.js`).

## Version

El contrato publico tiene una version semantica `MAYOR.MENOR.PARCHE` en
`compartido/contratos/openapi.js` (`VERSION_CONTRATO`), visible en
`info.version` del OpenAPI.

| Cambio | Version |
|--------|---------|
| Corregir una descripcion o un ejemplo | PARCHE |
| Agregar un endpoint, un campo opcional de entrada, un campo nuevo en una respuesta, un status de error nuevo y documentado | MENOR |
| Cualquier cambio incompatible (tabla de abajo) | MAYOR |

## Que es un cambio incompatible

- Quitar o renombrar un endpoint, un campo de respuesta o un parametro.
- Hacer obligatorio un campo que era opcional, o agregar un campo obligatorio.
- Cambiar el tipo o el formato de un campo (`"12"` -> `12`, fecha sin hora -> con hora).
- Cambiar el status de una respuesta existente (por ejemplo, 400 -> 409).
- Restringir un valor que antes se aceptaba (un `enum` mas chico, un minimo mas alto).
- Cambiar quien puede llamar un endpoint (roles) de forma que alguien pierda acceso.
- Renombrar un evento o cambiar el significado de un campo de su payload: las
  filas de `event_outbox` ya escritas quedarian huerfanas.

## Proceso para cambiar un contrato

1. **Evaluar a los consumidores.** Buscar la ruta en el frontend:
   `grep -rn "/api/<ruta>" human-firewall-frontend/src`. Para un contrato
   interno, buscar quien usa la funcion: `grep -rn "<funcion>" src/servicios/*/infrastructure/clientes`.
   Para un evento, mirar `consume` en los manifiestos (o `docs/arquitectura/SERVICIOS.md`).
2. **Si es compatible:** cambiar el DTO y el contrato juntos (el cuerpo
   documentado es el mismo objeto que valida la ruta), subir MENOR o PARCHE y
   anotarlo en el CHANGELOG.
3. **Si es incompatible:** preferir agregar antes que cambiar. Un campo nuevo
   al lado del viejo, el viejo marcado `deprecated: true` en el esquema (como
   `points_required` y `badge_id`), y una entrada en el CHANGELOG con la
   version en la que se va a quitar. Se quita recien cuando ningun consumidor
   lo usa, subiendo MAYOR.
4. **Si no hay otra salida** (por ejemplo, un agujero de seguridad), se
   cambia, se sube MAYOR y se actualizan los consumidores en el mismo PR.
5. **Probar:** `npm test`. La suite de contratos falla si una ruta no esta
   documentada, si la seguridad o la validacion documentadas no son las
   reales, o si una respuesta real no cumple su esquema.
6. **Documentar:** `npm run docs:arquitectura` regenera el catalogo de servicios.

## Revision en el PR

Todo PR que toque `contract/`, `controller/dto.js`, un `index.js` de servicio o
el catalogo de eventos tiene que decir en la descripcion:

- que contrato cambio y si es compatible;
- que consumidores revisaste;
- la entrada del CHANGELOG.
