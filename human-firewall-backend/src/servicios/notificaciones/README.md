# Servicio de notificaciones

Bandeja in-app, notificacion de resultados (con alerta a RH en cursos
criticos), preferencias por canal y cola de correo con plantillas e idioma.
Solo consume eventos: nunca vuelve a evaluar un resultado, arma el aviso con
lo que trae el evento.

Ficha completa: [`docs/arquitectura/SERVICIOS.md`](../../../../docs/arquitectura/SERVICIOS.md#notificaciones).

## Donde hacer un cambio

| Quiero... | Toco |
|-----------|------|
| Avisar ante un evento nuevo | `application/notifications.service.js` -> `PLANTILLAS`, o `resultNotifications.service.js` si es un resultado |
| Un correo nuevo | un tipo en `email_notification_types`, su plantilla en `email_templates` y su handler en `application/emailNotifications.service.js` |
| Saber el correo, idioma o RH de alguien | `infrastructure/client/identidad.cliente.js` (no leer `users`) |
| El titulo de un curso, desafio o simulacion | los clientes de cursos y evaluaciones |

## Reglas que no hay que romper

- Ninguna ruta recibe un `userId`: el id sale del token.
- Una notificacion se identifica por su `dedupe_key`: reprocesar un evento no
  duplica avisos ni correos.
- Los correos criticos (seguridad) no se pueden desactivar.
- La marca de curso critico se cambia desde aca, pero la escribe cursos.
