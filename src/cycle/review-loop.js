import { reviewPR } from '../agents/reviewer.js';
import { fixReviewIssues } from '../agents/coder.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES, AGENT_STATES } from '../events/event-bus.js';
import { komodoState, DASHBOARD_AGENT_STATES } from '../state/komodo-state.js';

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

    komodoState.updatePhase?.call?.(komodoState, 'reviewing', { reviewCycle: i });

    eventBus.emitEvent(EVENT_TYPES.REVIEW_CYCLE_START, {
      agentName: 'REVIEWER',
      metadata: { cycle: i, maxCycles, prNumber, repo },
    });

    // === REVIEWER ===
    komodoState.updateAgent('REVIEWER', { status: DASHBOARD_AGENT_STATES.WORKING });

    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'REVIEWER',
      previousState: i === 1 ? AGENT_STATES.WORKING : AGENT_STATES.WAITING,
      newState: AGENT_STATES.WORKING,
    });
    eventBus.emitAgentEvent('REVIEWER', 'working', { cycle: i });

    const reviewResult = await reviewPR({ prNumber, repo, taskSpec, cwd });

    if (reviewResult.cost) {
      eventBus.emitEvent(EVENT_TYPES.COST_UPDATED, {
        agentName: 'REVIEWER',
        metadata: { cost: reviewResult.cost },
      });
    }

    eventBus.emitAgentEvent('REVIEWER', 'done');
    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'REVIEWER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.WAITING,
    });
    eventBus.emitAgentEvent('REVIEWER', 'idle');

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

    // ¿Aprobado?
    if (lastReview.verdict === 'APPROVED') {
      logger.success(`PR #${prNumber} aprobada en ciclo ${i}`, 'KOMODO');

      eventBus.emitEvent(EVENT_TYPES.REVIEW_CYCLE_END, {
        agentName: 'REVIEWER',
        metadata: { cycle: i, maxCycles, prNumber, verdict: 'APPROVED' },
      });

      return {
        approved: true,
        cycles,
        finalReview: lastReview,
      };
    }

    // REQUEST_CHANGES — si es la última ronda, no intentar arreglar
    if (i === maxCycles) {
      logger.warn(`Máximo de ciclos (${maxCycles}) alcanzado. PR no aprobada.`, 'KOMODO');

      eventBus.emitEvent(EVENT_TYPES.REVIEW_CYCLE_END, {
        agentName: 'REVIEWER',
        metadata: { cycle: i, maxCycles, prNumber, verdict: 'REQUEST_CHANGES' },
      });

      break;
    }

    eventBus.emitEvent(EVENT_TYPES.REVIEW_CYCLE_END, {
      agentName: 'REVIEWER',
      metadata: { cycle: i, maxCycles, prNumber, verdict: 'REQUEST_CHANGES' },
    });

    // === CODER FIX ===
    logger.info(`Coder arreglando ${(lastReview.issues || []).length} issues...`, 'KOMODO');

    komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.WORKING });

    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'CODER',
      previousState: i === 1 ? AGENT_STATES.IDLE : AGENT_STATES.WAITING,
      newState: AGENT_STATES.WORKING,
    });
    eventBus.emitAgentEvent('CODER', 'working', { cycle: i, fixing: true });

    const fixResult = await fixReviewIssues(taskSpec, prNumber, lastReview, cwd);

    if (fixResult.cost) {
      eventBus.emitEvent(EVENT_TYPES.COST_UPDATED, {
        agentName: 'CODER',
        metadata: { cost: fixResult.cost },
      });
    }

    eventBus.emitAgentEvent('CODER', 'done', { cycle: i, fixing: true });
    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'CODER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.WAITING,
    });
    eventBus.emitAgentEvent('CODER', 'idle');
    komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.IDLE });

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
