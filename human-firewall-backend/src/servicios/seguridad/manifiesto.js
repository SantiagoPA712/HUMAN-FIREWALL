/** Ficha del servicio de seguridad. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'seguridad',
    responsabilidad:
        'Deteccion de abuso de puntos (anomalias), auditoria de ajustes manuales y ' +
        'registro centralizado e inmutable de acciones criticas (data.logs).',
    prefijos: ['/api/gamification/security', '/api/gamification/users', '/api/logs'],
    // Esquemas de PostgreSQL del servicio (migracion 090). Sus tablas viven ahi.
    esquemas: ['seguridad', 'data'],
    tablas: [
        'seguridad.anomaly_rules', 'seguridad.anomaly_events', 'seguridad.anomaly_status_history',
        'seguridad.audit_log', 'data.logs', 'data.logs_purges', 'seguridad.activity_logs'
    ],
    publica: ['audit.log_recorded'],
    consume: ['points_assigned', 'audit.log_recorded'],
    dependeDe: ['identidad', 'gamificacion'],
    lecturasCompartidas: [
        {
            tablas: ['gamificacion.points_ledger'], servicio: 'gamificacion',
            motivo: 'La deteccion de anomalias analiza ventanas de movimientos del historial de puntos. ' +
                    'Solo lee: los ajustes manuales se aplican por el contrato de gamificacion.'
        },
        {
            tablas: ['identidad.users'], servicio: 'identidad',
            motivo: 'Los listados del panel muestran el correo del actor y del afectado con un JOIN.'
        }
    ],
    escriturasCompartidas: [],
    procesos: ['Job de respaldo de deteccion de anomalias', 'Job de retencion de data.logs']
};
