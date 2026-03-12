import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';

/**
 * Autonomy levels available in Komodo.
 *
 * - SUPERVISED: pauses before every step, requires human approval
 * - SEMI_AUTONOMOUS: pauses before merge and when review score is low
 * - AUTONOMOUS: fully automatic, no pauses (default)
 * - GUARDIAN: automatic with dynamic gates (diff size, complexity thresholds)
 */
export const AUTONOMY_LEVELS = {
  SUPERVISED: 'supervised',
  SEMI_AUTONOMOUS: 'semi-autonomous',
  AUTONOMOUS: 'autonomous',
  GUARDIAN: 'guardian',
};

/**
 * Steps in the Komodo cycle where checkpoints can be inserted.
 */
export const AUTONOMY_STEPS = {
  AFTER_PLAN: 'after-plan',           // After Planner selects a task
  AFTER_ARCHITECT: 'after-architect', // After Architect generates plan
  AFTER_CODE: 'after-code',           // After Coder opens PR
  BEFORE_MERGE: 'before-merge',       // Before merging the PR
};

/**
 * Which steps trigger a pause per level.
 *
 * @type {Object<string, string[]>}
 */
const PAUSE_STEPS_BY_LEVEL = {
  [AUTONOMY_LEVELS.SUPERVISED]: [
    AUTONOMY_STEPS.AFTER_PLAN,
    AUTONOMY_STEPS.AFTER_ARCHITECT,
    AUTONOMY_STEPS.AFTER_CODE,
    AUTONOMY_STEPS.BEFORE_MERGE,
  ],
  [AUTONOMY_LEVELS.SEMI_AUTONOMOUS]: [
    AUTONOMY_STEPS.BEFORE_MERGE,
    // AFTER_CODE also when review score is low — handled dynamically in shouldPause()
  ],
  [AUTONOMY_LEVELS.AUTONOMOUS]: [],
  [AUTONOMY_LEVELS.GUARDIAN]: [], // handled dynamically via gate evaluation
};

/**
 * Creates and returns the autonomy engine instance.
 *
 * @param {Object} [options]
 * @param {string} [options.level] - Override the autonomy level (for testing)
 * @returns {Object} Autonomy engine
 */
export function createAutonomyEngine(options = {}) {
  const level = options.level || config.autonomyLevel || AUTONOMY_LEVELS.AUTONOMOUS;

  /**
   * Evaluates dynamic Guardian gates.
   *
   * @param {Object} context
   * @returns {boolean} true if the Guardian gate triggers a pause
   */
  function _evaluateGuardianGates(context) {
    const diffLines = context?.diffLines ?? 0;
    const complexity = context?.complexity ?? 0;

    if (diffLines > config.guardianMaxDiffLines) {
      logger.info(
        `Guardian gate: diff lines (${diffLines}) exceeds max (${config.guardianMaxDiffLines})`,
        'AUTONOMY',
      );
      return true;
    }

    if (complexity > config.guardianMaxComplexity) {
      logger.info(
        `Guardian gate: complexity (${complexity}) exceeds max (${config.guardianMaxComplexity})`,
        'AUTONOMY',
      );
      return true;
    }

    return false;
  }

  /**
   * Decides whether the engine should pause at a given step.
   *
   * @param {string} step - One of AUTONOMY_STEPS values
   * @param {Object} [context] - Step-specific context (reviewScore, diffLines, complexity)
   * @returns {boolean}
   */
  function shouldPause(step, context = {}) {
    const normalizedLevel = level.toLowerCase();

    if (normalizedLevel === AUTONOMY_LEVELS.SUPERVISED) {
      return true;
    }

    if (normalizedLevel === AUTONOMY_LEVELS.AUTONOMOUS) {
      return false;
    }

    if (normalizedLevel === AUTONOMY_LEVELS.SEMI_AUTONOMOUS) {
      if (step === AUTONOMY_STEPS.BEFORE_MERGE) return true;
      // Pause before merge when review score is low
      if (step === AUTONOMY_STEPS.AFTER_CODE) {
        const score = context?.reviewScore ?? null;
        if (score !== null && score < config.autonomyLowScoreThreshold) {
          logger.info(
            `Semi-autonomous: low review score (${score} < ${config.autonomyLowScoreThreshold}), requesting approval`,
            'AUTONOMY',
          );
          return true;
        }
      }
      return false;
    }

    if (normalizedLevel === AUTONOMY_LEVELS.GUARDIAN) {
      return _evaluateGuardianGates(context);
    }

    return false;
  }

  /**
   * Polls until approval is granted or the timeout expires.
   *
   * @param {string} step
   * @param {string} [taskId]
   * @returns {Promise<boolean>} true if approved, false if timed out
   */
  async function _waitForApproval(step, taskId) {
    const timeoutMs = config.approvalTimeoutMinutes * 60 * 1000;
    const pollIntervalMs = 500;
    const deadline = Date.now() + timeoutMs;

    komodoState.resetApproval();
    komodoState.setExecutionState(EXECUTION_STATES.AWAITING_APPROVAL);

    eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVAL_REQUESTED, {
      metadata: { step, taskId, timeoutMs, level },
    });

    logger.info(
      `[AUTONOMY] Waiting for approval at step "${step}" (timeout: ${config.approvalTimeoutMinutes}min)`,
      'AUTONOMY',
    );

    while (Date.now() < deadline) {
      if (komodoState.isApprovalGranted()) {
        komodoState.resetApproval();
        komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

        eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVAL_GRANTED, {
          metadata: { step, taskId, level },
        });

        logger.info(`[AUTONOMY] Approval granted at step "${step}"`, 'AUTONOMY');
        return true;
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    // Timeout
    komodoState.setExecutionState(EXECUTION_STATES.PAUSED);

    eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVAL_TIMED_OUT, {
      metadata: { step, taskId, timeoutMs, level },
    });

    logger.warn(
      `[AUTONOMY] Approval timeout at step "${step}" after ${config.approvalTimeoutMinutes}min`,
      'AUTONOMY',
    );

    return false;
  }

  /**
   * Checkpoint: if the level requires a pause at this step, waits for human approval.
   * Returns false if approval was not granted (timed out), true otherwise.
   *
   * @param {string} step - One of AUTONOMY_STEPS values
   * @param {Object} [context] - Step-specific context
   * @returns {Promise<boolean>} false if timed out / denied
   */
  async function checkPoint(step, context = {}) {
    if (!shouldPause(step, context)) return true;

    return _waitForApproval(step, context?.taskId);
  }

  return {
    level,
    shouldPause,
    checkPoint,
  };
}

/** Singleton instance driven by config. */
export const autonomyEngine = createAutonomyEngine();
