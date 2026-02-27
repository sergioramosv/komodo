import { reviewPR } from '../agents/reviewer.js';
import { fixReviewIssues } from '../agents/coder.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, AGENT_STATES } from '../events/event-bus.js';

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
  const cycleHistory = [];

  for (let i = 1; i <= maxCycles; i++) {
    cycles = i;
    const cycleData = { cycle: i, review: null, fix: null };
    logger.info(`Review cycle ${i}/${maxCycles}`, 'KOMODO');

    eventBus.emitEvent('review:cycle', {
      agentName: 'REVIEWER',
      metadata: { cycle: i, maxCycles, prNumber },
    });

    // === REVIEWER ===
    eventBus.emitEvent('agent:state-change', {
      agentName: 'REVIEWER',
      previousState: AGENT_STATES.IDLE,
      newState: AGENT_STATES.WORKING,
      metadata: { step: 'reviewPR', cycle: i },
    });

    const reviewResult = await reviewPR({ prNumber, repo, taskSpec, cwd });

    eventBus.emitEvent('agent:state-change', {
      agentName: 'REVIEWER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.IDLE,
      metadata: { success: reviewResult.success, cycle: i },
    });

    if (!reviewResult.success) {
      logger.error(`Reviewer falló en ciclo ${i}: ${reviewResult.error}`, 'KOMODO');
      cycleData.review = { error: reviewResult.error };
      cycleHistory.push(cycleData);
      return {
        approved: false,
        cycles,
        finalReview: null,
        cycleHistory,
        error: `Reviewer error: ${reviewResult.error}`,
      };
    }

    lastReview = reviewResult.review;
    cycleData.review = {
      verdict: lastReview.verdict,
      score: lastReview.score,
      issueCount: (lastReview.issues || []).length,
      issues: lastReview.issues || [],
      positives: lastReview.positives || [],
      summary: lastReview.summary,
      cost: reviewResult.cost,
      duration: reviewResult.duration,
    };

    // ¿Aprobado?
    if (lastReview.verdict === 'APPROVED') {
      logger.success(`PR #${prNumber} aprobada en ciclo ${i}`, 'KOMODO');
      cycleHistory.push(cycleData);
      return {
        approved: true,
        cycles,
        finalReview: lastReview,
        cycleHistory,
      };
    }

    // REQUEST_CHANGES — si es la última ronda, no intentar arreglar
    if (i === maxCycles) {
      logger.warn(`Máximo de ciclos (${maxCycles}) alcanzado. PR no aprobada.`, 'KOMODO');
      cycleHistory.push(cycleData);
      break;
    }

    // === CODER FIX ===
    logger.info(`Coder arreglando ${(lastReview.issues || []).length} issues...`, 'KOMODO');

    eventBus.emitEvent('agent:state-change', {
      agentName: 'CODER',
      previousState: AGENT_STATES.IDLE,
      newState: AGENT_STATES.WORKING,
      metadata: { step: 'fixReviewIssues', cycle: i, issueCount: (lastReview.issues || []).length },
    });

    const fixResult = await fixReviewIssues(taskSpec, prNumber, lastReview, cwd);

    eventBus.emitEvent('agent:state-change', {
      agentName: 'CODER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.IDLE,
      metadata: { success: fixResult.success, cycle: i },
    });

    if (!fixResult.success) {
      logger.error(`Coder no pudo arreglar issues en ciclo ${i}: ${fixResult.error}`, 'KOMODO');
      cycleData.fix = { error: fixResult.error };
      cycleHistory.push(cycleData);
      return {
        approved: false,
        cycles,
        finalReview: lastReview,
        cycleHistory,
        error: `Coder fix error: ${fixResult.error}`,
      };
    }

    cycleData.fix = {
      issuesResolved: fixResult.fix?.issuesResolved || [],
      issuesNotResolved: fixResult.fix?.issuesNotResolved || [],
      filesChanged: fixResult.fix?.filesChanged || [],
      summary: fixResult.fix?.summary,
      cost: fixResult.cost,
      duration: fixResult.duration,
    };
    cycleHistory.push(cycleData);

    logger.success('Fixes pusheados. Relanzando review...', 'KOMODO');
  }

  return {
    approved: false,
    cycles,
    finalReview: lastReview,
    cycleHistory,
    error: `PR no aprobada después de ${maxCycles} ciclos`,
  };
}
