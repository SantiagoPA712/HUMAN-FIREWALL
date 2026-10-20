/** Ficha del servicio de seguridad. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'seguridad',
    responsabilidad:
        'Deteccion de abuso de puntos (anomalias), auditoria de ajustes manuales y ' +
        'registro centralizado e inmutable de acciones criticas (data.logs).',
    prefijos: ['/api/gamification/security', '/api/gamification/users', '/api/logs'],
    tablas: [
        'anomaly_rules', 'anomaly_events', 'anomaly_status_history',
        'audit_log', 'data.logs', 'data.logs_purges', 'activity_logs'
    ],
    publica: ['audit.log_recorded'],
    consume: ['points_assigned', 'audit.log_recorded'],
    dependeDe: ['identidad', 'gamificacion'],
    lecturasCompartidas: [
        {
            tablas: ['points_ledger'], servicio: 'gamificacion',
            motivo: 'La deteccion de anomalias analiza ventanas de movimientos del historial de puntos. ' +
                    'Solo lee: los ajustes manuales se aplican por el contrato de gamificacion.'
        },
        {
            tablas: ['users'], servicio: 'identidad',
            motivo: 'Los listados del panel muestran el correo del actor y del afectado con un JOIN.'
        }
    ],
    escriturasCompartidas: [],
    procesos: ['Job de respaldo de deteccion de anomalias', 'Job de retencion de data.logs']
};
