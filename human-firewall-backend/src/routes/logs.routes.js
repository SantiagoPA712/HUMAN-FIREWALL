const express = require('express');
const router = express.Router();

const logsController = require('../controllers/logs.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

// ---------------------------------------------------------------------
// Logs de auditoria (HU: registro centralizado data.logs)
// ---------------------------------------------------------------------
//
// Criterio tecnico 3: "Si llega una solicitud a GET /api/logs, debo verificar
// que el token JWT sea valido y que el claim role sea admin. Si el rol no
// corresponde, debo retornar HTTP 403 sin ejecutar ninguna consulta a base de
// datos. Esta validacion debe ejecutarse en el middleware antes de llegar al
// controlador."
//
//   verifyToken()           -> valida la firma del JWT y llena req.user (401 si no)
//   requireRoles(['admin']) -> 403 si el claim role no es admin
//
// Va con router.use y no ruta por ruta: asi ninguna ruta que se agregue mas
// adelante en este archivo puede quedar sin la verificacion por olvido.
// Ninguno de los dos middlewares consulta la base: el rol sale del token.
router.use(verifyToken(), requireRoles(['admin']));

// Las rutas fijas van antes que /:id para que "filtros" y "export" no se
// lean como un id.
router.get('/', logsController.listLogs);
router.get('/filtros', logsController.getFilterOptions);
router.get('/export', logsController.exportLogs);
router.get('/:id', logsController.getLog);

// Criterio tecnico 4: cualquier otro metodo se rechaza en la aplicacion.
router.all(['/', '/:id'], logsController.methodNotAllowed);

module.exports = router;
