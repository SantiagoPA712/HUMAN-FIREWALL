/**
 * Contrato publico (OpenAPI) del servicio de evaluaciones.
 * Ver servicios/identidad/contrato/openapi.js para el formato.
 */

const { operacion } = require('../../../compartido/contratos/operacion');
const { ref } = require('../../../compartido/contratos/esquemas-comunes');
const esquemas = require('../controller/dto');

const fecha = { type: 'string', format: 'date-time' };

const schemas = {
    SimulacionDisponible: {
        type: 'object',
        required: ['id', 'title', 'pasos', 'intentada'],
        properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            description: { type: ['string', 'null'] },
            difficulty: { type: ['string', 'null'] },
            course_id: { type: ['integer', 'null'] },
            curso: { type: ['string', 'null'], description: 'Titulo del curso (lo provee el servicio de cursos)' },
            pasos: { type: 'integer' },
            intentada: { type: 'boolean' }
        }
    },
    Simulacion: {
        type: 'object',
        required: ['id', 'title'],
        properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            description: { type: ['string', 'null'] },
            difficulty: { type: ['string', 'null'] },
            created_by: { type: ['integer', 'null'] },
            created_at: fecha,
            course_id: { type: ['integer', 'null'] }
        }
    },
    PasoDeSimulacion: {
        type: 'object',
        required: ['id', 'simulation_id', 'scenario_text'],
        properties: {
            id: { type: 'integer' },
            simulation_id: { type: 'integer' },
            scenario_text: { type: 'string' },
            order_idx: { type: 'integer' }
        }
    },
    OpcionDeSimulacion: {
        type: 'object',
        required: ['id', 'step_id', 'option_text'],
        properties: {
            id: { type: 'integer' },
            step_id: { type: 'integer' },
            option_text: { type: 'string' },
            is_correct: { type: 'boolean' },
            points_awarded: { type: 'integer' },
            feedback_text: { type: ['string', 'null'] }
        }
    },
    SimulacionDetalle: {
        allOf: [
            ref('Simulacion'),
            {
                type: 'object',
                required: ['steps'],
                properties: {
                    steps: {
                        type: 'array',
                        items: {
                            allOf: [
                                ref('PasoDeSimulacion'),
                                { type: 'object', properties: { options: { type: 'array', items: ref('OpcionDeSimulacion') } } }
                            ]
                        }
                    }
                }
            }
        ]
    },
    Decision: {
        type: 'object',
        required: ['is_correct', 'puntos_estimados', 'ya_contabilizada'],
        properties: {
            is_correct: { type: 'boolean' },
            feedback: { type: ['string', 'null'] },
            puntos_estimados: { type: 'integer', description: 'Los puntos reales los otorga gamificacion al consumir simulation.decision_made' },
            ya_contabilizada: { type: 'boolean' }
        }
    },
    ResultadoDeSimulacion: {
        type: 'object',
        required: ['simulation_id', 'score', 'aprobada', 'aciertos', 'pasos'],
        properties: {
            simulation_id: { type: 'integer' },
            titulo: { type: 'string' },
            score: { type: 'integer', minimum: 0, maximum: 100, description: 'Calculado en el servidor' },
            aprobada: { type: 'boolean', description: 'score >= 60' },
            aciertos: { type: 'integer' },
            pasos: { type: 'integer' },
            puntaje_obtenido: { type: 'integer' },
            puntaje_maximo: { type: 'integer' },
            intento_no: { type: 'integer' }
        }
    },
    ResultadoDeDesafio: {
        type: 'object',
        required: ['msg', 'aprobado', 'score', 'ya_completado', 'puntos_estimados'],
        properties: {
            msg: { type: 'string' },
            aprobado: { type: 'boolean' },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            ya_completado: { type: 'boolean' },
            puntos_estimados: { type: 'integer' }
        }
    }
};

const paths = {
    '/api/simulations': {
        get: operacion({
            resumen: 'Simulaciones disponibles',
            descripcion:
                'Un empleado ve las de sus cursos asignados y las que no pertenecen a ningun curso (RN-01), ' +
                'solo si tienen pasos. admin e instructor ven todas.',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Simulaciones', esquema: { type: 'array', items: ref('SimulacionDisponible') } } }
        }),
        post: operacion({
            resumen: 'Crear una simulacion',
            acceso: ['admin', 'instructor'],
            dto: esquemas.crearSimulacion,
            respuestas: { 201: { descripcion: 'Simulacion creada', esquema: ref('Simulacion') } }
        })
    },
    '/api/simulations/{simulationId}': {
        get: operacion({
            resumen: 'Detalle de una simulacion con pasos y opciones',
            acceso: 'autenticado',
            dto: esquemas.porSimulacion,
            respuestas: { 200: { descripcion: 'Simulacion', esquema: ref('SimulacionDetalle') } },
            errores: [404]
        })
    },
    '/api/simulations/{simulationId}/steps': {
        post: operacion({
            resumen: 'Agregar un paso a una simulacion',
            acceso: ['admin', 'instructor'],
            dto: esquemas.agregarPaso,
            respuestas: { 201: { descripcion: 'Paso creado', esquema: ref('PasoDeSimulacion') } }
        })
    },
    '/api/simulations/steps/{stepId}/options': {
        post: operacion({
            resumen: 'Agregar una opcion a un paso',
            acceso: ['admin', 'instructor'],
            dto: esquemas.agregarOpcion,
            respuestas: { 201: { descripcion: 'Opcion creada', esquema: ref('OpcionDeSimulacion') } }
        })
    },
    '/api/simulations/submit-decision': {
        post: operacion({
            resumen: 'Registrar una decision dentro de una simulacion',
            descripcion: 'Publica simulation.decision_made. Cada opcion paga una sola vez por usuario.',
            acceso: 'autenticado',
            dto: esquemas.registrarDecision,
            respuestas: { 200: { descripcion: 'Retroalimentacion de la opcion', esquema: ref('Decision') } },
            errores: [404]
        })
    },
    '/api/simulations/{simulationId}/complete': {
        post: operacion({
            resumen: 'Cerrar una simulacion',
            descripcion:
                'Calcula el puntaje en el servidor a partir de las opciones elegidas, registra el intento ' +
                'y publica simulation.completed. Una opcion de otra simulacion se rechaza con 400.',
            acceso: 'autenticado',
            dto: esquemas.completarSimulacion,
            respuestas: { 200: { descripcion: 'Resultado', esquema: ref('ResultadoDeSimulacion') } },
            errores: [404]
        })
    },
    '/api/gamification/challenge': {
        post: operacion({
            resumen: 'Registrar el resultado de un desafio del portal',
            descripcion:
                'El intento se registra siempre. Al aprobar publica quiz.approved (gamificacion otorga los ' +
                'puntos); al reprobar, quiz.failed. La URL conserva el prefijo /api/gamification por ' +
                'compatibilidad, pero la atiende el servicio de evaluaciones.',
            acceso: 'autenticado',
            dto: esquemas.registrarDesafio,
            respuestas: { 200: { descripcion: 'Resultado registrado', esquema: ref('ResultadoDeDesafio') } },
            errores: [404]
        })
    }
};

module.exports = { paths, schemas };
