import { reviewPR } from '../agents/reviewer.js';
import { fixReviewIssues } from '../agents/coder.js';
import { analyzeSonar } from '../sonar/analyzer.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES, AGENT_STATES } from '../events/event-bus.js';
import { komodoState, DASHBOARD_AGENT_STATES } from '../state/komodo-state.js';
import { checkpointManager } from '../state/checkpoint-manager.js';
import { recordReviewIssues, recordAvoidedPatterns } from './review-feedback-recorder.js';
import { getEscalationModel } from '../triage/smart-model-router.js';

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
 * @param {Object} [options.sonarReport] - Reporte de análisis SonarQube
 * @returns {Promise<{
 *   approved: boolean,
 *   cycles: number,
 *   finalReview: Object | null,
 *   error?: string
 * }>}
 */
export async function reviewLoop({ prNumber, repo, taskSpec, cwd, sonarReport: initialSonarReport, coverageReport, qaReport, reviewerModel, coderModel, coderCli, codingGuidelines, pluginIssues }) {
  let sonarReport = initialSonarReport;
  const maxCycles = config.maxReviewCycles;
  let cycles = 0;
  let lastReview = null;
  let lastReviewSHA = null;
  let totalCost = 0;
  let activeCoderModel = coderModel;

  for (let i = 1; i <= maxCycles; i++) {
    cycles = i;
    logger.info(`Review cycle ${i}/${maxCycles}`, 'KOMODO');

    komodoState.updatePhase?.call?.(komodoState, 'reviewing', { reviewCycle: i });

    eventBus.emitEvent(EVENT_TYPES.REVIEW_CYCLE_START, {
      agentName: 'REVIEWER',
      metadata: { cycle: i, maxCycles, prNumber, repo },
    });

    // === REVIEWER ===
    checkpointManager.setFlowContext({ flowStep: 'review', reviewIssues: null });
    komodoState.updateAgent('REVIEWER', { status: DASHBOARD_AGENT_STATES.WORKING });

    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'REVIEWER',
      previousState: i === 1 ? AGENT_STATES.WORKING : AGENT_STATES.WAITING,
      newState: AGENT_STATES.WORKING,
    });
    eventBus.emitAgentEvent('REVIEWER', 'working', { cycle: i });

    const reviewResult = await reviewPR({
      prNumber, repo, taskSpec, cwd, sonarReport, coverageReport, qaReport,
      model: reviewerModel, codingGuidelines,
      reviewCycle: i,
      previousReview: lastReview,
      lastReviewSHA,
      pluginIssues,
    });

    if (reviewResult.cost) {
      totalCost += reviewResult.cost;
      eventBus.emitEvent(EVENT_TYPES.COST_UPDATED, {
        agentName: 'REVIEWER',
        metadata: { cost: reviewResult.cost },
      });
    }

    if (reviewResult.incremental && reviewResult.incrementalMetrics) {
      logger.info(
        `Incremental review saved ~${reviewResult.incrementalMetrics.tokensSaved} tokens (~${reviewResult.incrementalMetrics.percentageSaved}%)`,
        'KOMODO',
      );
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
        cost: totalCost,
        sonarReport,
        error: `Reviewer error: ${reviewResult.error}`,
      };
    }

    lastReview = reviewResult.review;
    lastReviewSHA = reviewResult.reviewSHA || lastReviewSHA;

    // ¿Aprobado?
    if (lastReview.verdict === 'APPROVED') {
      logger.success(`PR #${prNumber} aprobada en ciclo ${i}`, 'KOMODO');

      // Record avoided patterns (Coder successfully avoided frequent mistakes)
      try {
        await recordAvoidedPatterns(lastReview.issues || []);
      } catch (err) {
        logger.warn(`Could not record avoided patterns: ${err.message}`, 'KOMODO');
      }

      eventBus.emitEvent(EVENT_TYPES.REVIEW_CYCLE_END, {
        agentName: 'REVIEWER',
        metadata: {
          cycle: i, maxCycles, prNumber, verdict: 'APPROVED',
          score: lastReview.score,
          issuesCount: (lastReview.issues || []).length,
        },
      });

      return {
        approved: true,
        cycles,
        finalReview: lastReview,
        cost: totalCost,
        sonarReport,
      };
    }

    // REQUEST_CHANGES — si es la última ronda, no intentar arreglar
    if (i === maxCycles) {
      logger.warn(`Máximo de ciclos (${maxCycles}) alcanzado. PR no aprobada.`, 'KOMODO');

      eventBus.emitEvent(EVENT_TYPES.REVIEW_CYCLE_END, {
        agentName: 'REVIEWER',
        metadata: {
          cycle: i, maxCycles, prNumber, verdict: 'REQUEST_CHANGES',
          score: lastReview.score,
          issuesCount: (lastReview.issues || []).length,
        },
      });

      break;
    }

    eventBus.emitEvent(EVENT_TYPES.REVIEW_CYCLE_END, {
      agentName: 'REVIEWER',
      metadata: {
        cycle: i, maxCycles, prNumber, verdict: 'REQUEST_CHANGES',
        score: lastReview.score,
        issuesCount: (lastReview.issues || []).length,
      },
    });

    // Check for rate limit pause before Coder fix
    if (komodoState.isPauseRequested()) {
      logger.warn('Execution paused by rate limit during review loop.', 'KOMODO');
      return { approved: false, cycles, finalReview: lastReview, cost: totalCost, sonarReport, error: 'Paused: rate limit detected' };
    }

    // Record each review issue as a pattern in memory (for future feedback)
    try {
      await recordReviewIssues(lastReview.issues || [], taskSpec?.taskId, prNumber);
    } catch (err) {
      logger.warn(`Could not record review issues: ${err.message}`, 'KOMODO');
    }

    // === AUTO-ESCALATION: upgrade Coder model if score is below threshold ===
    if (config.smartModelRouting && coderCli && lastReview.score != null) {
      const escalationThreshold = config.smartModelRoutingEscalationThreshold;
      if (lastReview.score < escalationThreshold) {
        const escalated = getEscalationModel(coderCli, activeCoderModel);
        if (escalated !== activeCoderModel) {
          logger.info(
            `Auto-escalating Coder model: "${activeCoderModel}" → "${escalated}" (review score ${lastReview.score} < threshold ${escalationThreshold})`,
            'KOMODO',
          );
          eventBus.emitEvent(EVENT_TYPES.MODEL_ESCALATED, {
            metadata: {
              agentRole: 'CODER',
              cliType: coderCli,
              fromModel: activeCoderModel,
              toModel: escalated,
              triggerScore: lastReview.score,
              threshold: escalationThreshold,
              cycle: i,
            },
          });
          activeCoderModel = escalated;
        }
      }
    }

    // === CODER FIX ===
    checkpointManager.setFlowContext({ flowStep: 'fix', reviewIssues: lastReview.issues || [] });
    logger.info(`Coder arreglando ${(lastReview.issues || []).length} issues...`, 'KOMODO');

    komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.WORKING });

    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'CODER',
      previousState: i === 1 ? AGENT_STATES.IDLE : AGENT_STATES.WAITING,
      newState: AGENT_STATES.WORKING,
    });
    eventBus.emitAgentEvent('CODER', 'working', { cycle: i, fixing: true });

    const fixResult = await fixReviewIssues(taskSpec, prNumber, lastReview, cwd, { model: activeCoderModel, codingGuidelines });

    if (fixResult.cost) {
      totalCost += fixResult.cost;
      eventBus.emitEvent(EVENT_TYPES.COST_UPDATED, {
        agentName: 'CODER',
        metadata: { cost: fixResult.cost },
      });
    }

    eventBus.emitAgentEvent('CODER', 'done', { cycle: i, fixing: true, summary: fixResult.fix?.summary || '' });
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
        cost: totalCost,
        sonarReport,
        error: `Coder fix error: ${fixResult.error}`,
      };
    }

    logger.success('Fixes pusheados.', 'KOMODO');

    // Re-run SonarQube on the updated branch so the next review uses fresh data
    if (sonarReport && !sonarReport.skipped) {
      logger.info(`Re-ejecutando SonarQube tras fix (ciclo ${i})...`, 'KOMODO');
      komodoState.sonarAnalysis = { status: 'running', qualityGate: null, issues: null };

      try {
        const freshSonar = await analyzeSonar({
          branch: taskSpec.branchName,
          cwd,
          prNumber,
          repo,
        });

        if (freshSonar.success) {
          // Update the sonarReport reference so the next review cycle gets fresh data
          sonarReport = freshSonar;
          komodoState.sonarAnalysis = {
            status: 'done',
            qualityGate: freshSonar.qualityGate,
            issues: freshSonar.issues,
          };
          logger.info(`SonarQube post-fix: Quality Gate ${freshSonar.qualityGate}`, 'KOMODO');
        } else {
          logger.warn('SonarQube post-fix falló, continuando con reporte anterior...', 'KOMODO');
        }
      } catch (err) {
        logger.warn(`SonarQube post-fix error (non-blocking): ${err.message}`, 'KOMODO');
      }
    }

    logger.info('Relanzando review...', 'KOMODO');
  }

  return {
    approved: false,
    cycles,
    finalReview: lastReview,
    cost: totalCost,
    sonarReport,
    error: `PR no aprobada después de ${maxCycles} ciclos`,
  };
}
