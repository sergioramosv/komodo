import { config } from '../config.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { evaluateGuardianGates } from './guardian-gates.js';

/**
 * Autonomy levels available in Komodo.
 *
 * - SUPERVISED: Pauses at every cycle step, requiring human approval before continuing.
 * - SEMI_AUTONOMOUS: Pauses only before merge and when the review score is low.
 * - AUTONOMOUS: Fully automatic — no pauses, runs end-to-end without human interaction.
 * - GUARDIAN: Fully automatic but applies dynamic gates based on diff size and score thresholds.
 */
export const AUTONOMY_LEVELS = {
  SUPERVISED: 'supervised',
  SEMI_AUTONOMOUS: 'semi-autonomous',
  AUTONOMOUS: 'autonomous',
  GUARDIAN: 'guardian',
};

/**
 * Gate steps where autonomy checks can trigger a pause.
 */
export const GATE_STEPS = {
  AFTER_PLANNING: 'after_planning',
  AFTER_ARCHITECT: 'after_architect',
  BEFORE_MERGE: 'before_merge',
  AFTER_REVIEW: 'after_review',
};

let _levelLogged = false;

/**
 * Returns the active autonomy level from config.
 *
 * @returns {string} One of AUTONOMY_LEVELS values (defaults to 'autonomous' if invalid)
 */
export function getActiveLevel() {
  const level = (config.autonomyLevel || 'autonomous').toLowerCase();
  const valid = Object.values(AUTONOMY_LEVELS);
  if (!valid.includes(level)) {
    logger.warn(`AUTONOMY_LEVEL="${level}" no es válido. Usando "autonomous".`, 'AUTONOMY');
    return AUTONOMY_LEVELS.AUTONOMOUS;
  }

  if (!_levelLogged) {
    _levelLogged = true;
    logger.info(`Autonomy level: ${level}`, 'AUTONOMY');
    eventBus.emitEvent(EVENT_TYPES.AUTONOMY_LEVEL_LOADED, {
      metadata: { level },
    });
  }

  return level;
}

/**
 * Decides whether to pause at a given gate step based on the active autonomy level
 * and contextual data (review score, diff lines, etc.).
 *
 * @param {string} step - One of GATE_STEPS values
 * @param {Object} [context] - Contextual data for decision
 * @param {number|null} [context.reviewScore] - Review score (0-10), used by semi-autonomous and guardian
 * @param {number|null} [context.diffLines] - Total diff lines, used by guardian
 * @param {string[]} [context.filesChanged] - Files changed in the PR, used by guardian gates
 * @param {number|null} [context.usedTokens] - Token usage estimate, used by guardian gates
 * @param {number|null} [context.reviewCycles] - Number of review cycles completed, used by guardian gates
 * @returns {boolean} true if the engine recommends pausing for human approval
 */
export function shouldPause(step, context = {}) {
  const level = getActiveLevel();
  const { reviewScore = null, diffLines = null } = context;

  switch (level) {
    case AUTONOMY_LEVELS.SUPERVISED:
      // Always pause at every gate step
      return true;

    case AUTONOMY_LEVELS.SEMI_AUTONOMOUS:
      // Pause before merge and when review score is low
      if (step === GATE_STEPS.BEFORE_MERGE) return true;
      if (step === GATE_STEPS.AFTER_REVIEW && reviewScore !== null && reviewScore < config.minReviewScore) return true;
      return false;

    case AUTONOMY_LEVELS.AUTONOMOUS:
      // Never pause
      return false;

    case AUTONOMY_LEVELS.GUARDIAN:
      // Dynamic gates: pause when any guardian gate triggers or score is below threshold
      if (step === GATE_STEPS.BEFORE_MERGE) {
        const gateResult = evaluateGuardianGates(context);
        if (gateResult.shouldPause) {
          gateResult.triggeredGates.forEach((gate, i) => {
            logger.info(`Guardian gate [${gate}]: ${gateResult.reasons[i]}. Requiriendo aprobación.`, 'AUTONOMY');
          });
          eventBus.emitEvent(EVENT_TYPES.GUARDIAN_GATE_TRIGGERED, {
            metadata: { triggeredGates: gateResult.triggeredGates, reasons: gateResult.reasons },
          });
          return true;
        }
        if (reviewScore !== null && reviewScore < config.minReviewScore) {
          logger.info(
            `Guardian: review score (${reviewScore}) below threshold (${config.minReviewScore}). Requiriendo aprobación.`,
            'AUTONOMY',
          );
          return true;
        }
      }
      return false;

    default:
      return false;
  }
}
