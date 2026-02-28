import { reviewPR } from '../agents/reviewer.js';
import { fixReviewIssues } from '../agents/coder.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { bus, EventTypes, AgentStates } from '../events/event-bus.js';

/**
 * Ejecuta el bucle Coder ↔ Reviewer.
 *
 * 1. Reviewer revisa la PR
 * 2. Si APPROVED → termina
 * 3. Si REQUEST_CHANGES → Coder arregla, push, y vuelve a 1
 * 4. Máximo MAX_REVIEW_CYCLES rondas
 *
 * @param {Object} options
 * @param {number} options.prNumber - Número de la PR
 * @param {string} options.repo - Repositorio en formato owner/repo
 * @param {Object} options.taskSpec - Especificación de la tarea
 * @param {string} [options.cwd] - Directorio del repositorio
 * @returns {Promise<{
 *   approved: boolean,
 *   cycles: number,
 *   finalReview: Object | null,
 *   error?: string
 * }>}
 */
export async function reviewLoop({ prNumber, repo, taskSpec, cwd }) {
  const maxCycles = config.maxReviewCycles;
  let cycles = 0;
  let lastReview = null;

  for (let i = 1; i <= maxCycles; i++) {
    cycles = i;
    logger.info(`Review cycle ${i}/${maxCycles}`, 'KOMODO');

    // === REVIEWER ===
    bus.agentStateChange('REVIEWER', AgentStates.WORKING);
    const reviewResult = await reviewPR({ prNumber, repo, taskSpec, cwd });
    bus.agentStateChange('REVIEWER', AgentStates.IDLE);

    if (!reviewResult.success) {
      logger.error(`Reviewer falló en ciclo ${i}: ${reviewResult.error}`, 'KOMODO');
      return {
        approved: false,
        cycles,
        finalReview: null,
        error: `Reviewer error: ${reviewResult.error}`,
      };
    }

    lastReview = reviewResult.review;

    bus.emitEvent(EventTypes.REVIEW_CYCLE, {
      agentName: 'REVIEWER',
      cycle: i,
      maxCycles,
      prNumber,
      verdict: lastReview.verdict,
      metadata: {
        issuesCount: (lastReview.issues || []).length,
        taskId: taskSpec?.taskId,
      },
    });

    // ¿Aprobado?
    if (lastReview.verdict === 'APPROVED') {
      logger.success(`PR #${prNumber} aprobada en ciclo ${i}`, 'KOMODO');
      return {
        approved: true,
        cycles,
        finalReview: lastReview,
      };
    }

    // REQUEST_CHANGES — si es la última ronda, no intentar arreglar
    if (i === maxCycles) {
      logger.warn(`Máximo de ciclos (${maxCycles}) alcanzado. PR no aprobada.`, 'KOMODO');
      break;
    }

    // === CODER FIX ===
    logger.info(`Coder arreglando ${(lastReview.issues || []).length} issues...`, 'KOMODO');
    bus.agentStateChange('CODER', AgentStates.WORKING);

    const fixResult = await fixReviewIssues(taskSpec, prNumber, lastReview, cwd);
    bus.agentStateChange('CODER', AgentStates.IDLE);

    if (!fixResult.success) {
      logger.error(`Coder no pudo arreglar issues en ciclo ${i}: ${fixResult.error}`, 'KOMODO');
      return {
        approved: false,
        cycles,
        finalReview: lastReview,
        error: `Coder fix error: ${fixResult.error}`,
      };
    }

    logger.success('Fixes pusheados. Relanzando review...', 'KOMODO');
  }

  return {
    approved: false,
    cycles,
    finalReview: lastReview,
    error: `PR no aprobada después de ${maxCycles} ciclos`,
  };
}
