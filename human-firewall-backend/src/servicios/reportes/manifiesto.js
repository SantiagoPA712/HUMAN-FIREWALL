/** Ficha del servicio de reportes. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'reportes',
    responsabilidad:
        'Reporte de desempeno para RH con exportacion CSV/PDF, reportes automaticos ' +
        'programados con su historico y consolidado organizacional para gerencia.',
    prefijos: ['/api/gamification/reports'],
    tablas: [
        'report_exports', 'report_schedules', 'report_history', 'report_notifications',
        'org_kpi_snapshots', 'org_report_access_log'
    ],
    publica: ['report.export_requested', 'report.scheduled_run', 'report.auto_generated'],
    consume: ['report.export_requested', 'report.scheduled_run', 'report.auto_generated'],
    dependeDe: ['gamificacion', 'notificaciones', 'seguridad'],
    lecturasCompartidas: [
        {
            tablas: ['users', 'teams'], servicio: 'identidad',
            motivo: 'Servicio de lectura analitica: los reportes agregan por persona y por equipo ' +
                    'en SQL. Solo lee; no escribe nunca fuera de sus tablas.'
        },
        {
            tablas: ['points_ledger'], servicio: 'gamificacion',
            motivo: 'Los snapshots organizacionales se recalculan por un job sobre el historial de puntos.'
        },
        {
            tablas: ['quiz_attempts'], servicio: 'evaluaciones',
            motivo: 'Tasa de aprobacion por periodo y por equipo.'
        },
        {
            tablas: ['courses', 'course_assignments', 'lesson_progress'], servicio: 'cursos',
            motivo: 'Avance y cumplimiento de cursos por periodo y por equipo.'
        }
    ],
    escriturasCompartidas: [],
    procesos: ['Scheduler de reportes programados', 'Job de KPIs organizacionales']
};
