/** Ficha del servicio de reportes. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'reportes',
    responsabilidad:
        'Reporte de desempeno para RH con exportacion CSV/PDF, reportes automaticos ' +
        'programados con su historico y consolidado organizacional para gerencia.',
    prefijos: ['/api/gamification/reports'],
    // Esquemas de PostgreSQL del servicio (migracion 090). Sus tablas viven ahi.
    esquemas: ['reportes'],
    tablas: [
        'reportes.report_exports', 'reportes.report_schedules', 'reportes.report_history', 'reportes.report_notifications',
        'reportes.org_kpi_snapshots', 'reportes.org_report_access_log'
    ],
    publica: ['report.export_requested', 'report.scheduled_run', 'report.auto_generated'],
    consume: ['report.export_requested', 'report.scheduled_run', 'report.auto_generated'],
    dependeDe: ['identidad', 'cursos', 'evaluaciones', 'gamificacion', 'notificaciones', 'seguridad'],
    // Base de datos por servicio: reportes es de lectura analitica, pero ya no
    // hace JOIN con tablas ajenas. Cuentas y equipos los da identidad; puntos,
    // gamificacion; intentos, evaluaciones; asignaciones y lecciones, cursos.
    // Todo por contrato, y se agrega en memoria (application/actividad.js).
    lecturasCompartidas: [],
    escriturasCompartidas: [],
    procesos: ['Scheduler de reportes programados', 'Job de KPIs organizacionales']
};
