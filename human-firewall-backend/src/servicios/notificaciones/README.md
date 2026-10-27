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
| Una consulta | `infrastructure/persistence/notificaciones`, `resultados`, `correos` o `plantillas.repositorio.js` |
| Reglas de plantillas, reintentos o canales | `domain/plantilla.js`, `domain/entrega.js`, `domain/notificacion.js` |
| SMTP, remitente, URL base, idioma o zona horaria | `config/configuracion.js` (variables `SMTP_*`, `MAIL_FROM`, `APP_BASE_URL`...) |
| Una tabla o columna nueva | `migrations/servicios/notificaciones/002_....sql` (y siguientes) con `CREATE TABLE notificaciones.<tabla>`, y declararla en `manifiesto.js` |
| La base de datos del servicio | `config/configuracion.js` -> `baseDeDatos` (variable `NOTIFICACIONES_DATABASE_URL`) |

## Reglas que no hay que romper

- Ninguna ruta recibe un `userId`: el id sale del token.
- Una notificacion se identifica por su `dedupe_key`: reprocesar un evento no
  duplica avisos ni correos.
- Los correos criticos (seguridad) no se pueden desactivar.
- La marca de curso critico se cambia desde aca, pero la escribe cursos.
