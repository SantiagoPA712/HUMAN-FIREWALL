/**
 * Resultados organizacionales para gerencia.
 *
 * HU: "quiero ver resultados organizacionales consolidados del sistema de
 * gamificacion para evaluar el impacto del programa en el desempeno general
 * de la organizacion".
 *
 * Sin verificacion de rol aca dentro, por la misma razon que en los otros dos
 * controladores de reportes: el criterio tecnico 1 exige responder 403 "sin
 * ejecutar ninguna consulta de agregacion", y eso solo se cumple cortando en
 * el middleware. Ver gamification.routes.js:
 * verifyToken() -> requireRoles(['manager','admin']).
 */

const orgReports = require('../services/orgReports.service');

/**
 * GET /api/gamification/reports/organizational
 *
 * Query:
 *   period      YYYY-MM   periodo consultado (por defecto, el mes en curso)
 *   compare_to  YYYY-MM   periodo base de la comparacion (por defecto, el anterior)
 *   area_id     int       segmenta por area; sin el, consolidado de la organizacion
 */
exports.getOrganizationalReport = async (req, res) => {
    try {
        const reporte = await orgReports.obtenerReporteOrganizacional({
            userId: req.user.id,
            periodo: req.query.period,
            compararCon: req.query.compare_to,
            areaId: req.query.area_id
        });

        // Criterio tecnico 2: cuando no hay snapshot del periodo, el servicio
        // devuelve estado 'pendiente_de_calculo'. Es un 200, no un error: la
        // peticion es valida y la respuesta dice exactamente que pasa.
        res.status(200).json(reporte);

    } catch (error) {
        // Criterio tecnico 5: area inexistente o desactivada -> 404 con el
        // area_id que se recibio, para que quien consulta sepa cual fallo.
        if (error.codigo === 404) {
            return res.status(404).json({ msg: error.message, area_id: error.area_id });
        }

        if (error.codigo === 400) {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{ campo: error.campo, detalle: error.message }]
            });
        }

        res.status(500).json({ msg: error.message });
    }
};
