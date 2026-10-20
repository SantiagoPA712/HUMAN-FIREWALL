/**
 * Casos de uso de los desafios del portal (minijuegos).
 *
 * Vivia en gamification.controller.js (POST /api/gamification/challenge),
 * pero lo que hace es registrar un intento de evaluacion: escribe en
 * user_challenge_results y quiz_attempts, que son tablas de este servicio.
 * La URL no cambio; cambio quien la atiende. Los puntos los sigue
 * otorgando gamificacion al consumir quiz.approved.
 */

const db = require('../../../compartido/config/db');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { ErrorHttp } = require('../../../compartido/http/errores');
const repo = require('../infraestructura/evaluaciones.repositorio');
const { normalizarResultadoDesafio, PUNTAJE_MINIMO } = require('../dominio/puntaje');

/**
 * Registra el resultado de un desafio, ganado o perdido.
 *
 * Todo en una transaccion: el registro del desafio, el intento y el evento
 * se confirman juntos o no se confirma ninguno. Sin esto, si una escritura
 * falla, el UNIQUE de user_challenge_results bloquea el reintento y el
 * usuario pierde los puntos en silencio.
 */
async function registrarResultado(userId, { challengeId, passed, score }) {
    const { aprobado, puntaje } = normalizarResultadoDesafio({ passed, score });

    const client = await db.connect();
    try {
        const desafio = await repo.buscarDesafio(challengeId, client);
        if (!desafio) throw ErrorHttp.noEncontrado('Desafío no encontrado');

        await client.query('BEGIN');

        // Solo un desafio superado se marca como ganado. Un fallo queda
        // unicamente en el historial de intentos, para poder reintentarlo.
        let yaGanado = false;
        if (aprobado) {
            yaGanado = !(await repo.marcarDesafioGanado(userId, challengeId, client));
        }

        // El intento SIEMPRE se registra: es la materia prima del resumen de
        // desempeno y de las recomendaciones.
        const intento = await repo.registrarIntento({
            userId,
            quizRef: challengeId,
            quizType: 'challenge',
            courseId: desafio.course_id,
            score: puntaje,
            passingScore: PUNTAJE_MINIMO,
            passed: aprobado
        }, client);

        if (aprobado && !yaGanado) {
            // Reprobar no otorga puntos: el evento de aprobacion solo se emite al aprobar.
            await eventBus.publish(EVENTOS.QUIZ_APPROVED, {
                userId,
                quizRef: challengeId,
                quizType: 'challenge',
                score: puntaje,
                passed: true,
                basePoints: desafio.points_reward,
                courseId: desafio.course_id || null
            }, client);
        } else if (!aprobado) {
            // Notificaciones consume el hecho; no vuelve a evaluar nada.
            await eventBus.publish(EVENTOS.QUIZ_FAILED, {
                userId,
                quizRef: challengeId,
                quizType: 'challenge',
                score: puntaje,
                passed: false,
                attemptId: intento.id,
                attemptNo: intento.attempt_no,
                courseId: desafio.course_id || null
            }, client);
        }

        await client.query('COMMIT');

        return {
            msg: !aprobado
                ? 'Intento registrado: esta vez no lo superaste'
                : yaGanado ? 'Ya habías superado este desafío' : 'Desafío superado con éxito',
            aprobado,
            score: puntaje,
            ya_completado: yaGanado,
            puntos_estimados: (aprobado && !yaGanado) ? desafio.points_reward : 0
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { registrarResultado };
