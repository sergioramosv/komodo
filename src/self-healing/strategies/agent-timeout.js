import { logger } from '../../utils/logger.js';
import { config } from '../../config.js';

/** Timeout error patterns from base-agent.js */
const TIMEOUT_PATTERNS = [
  /Idle timeout:/i,
  /Total timeout:/i,
  /silent for \d+s/i,
  /exceeded \d+s/i,
];

/** Faster models to fall back to on timeout */
const FASTER_MODEL_FALLBACKS = {
  // Claude model fallbacks (haiku is the fastest)
  'claude-opus': 'claude-haiku-4-5-20251001',
  'claude-sonnet': 'claude-haiku-4-5-20251001',
  'claude-haiku': 'claude-haiku-4-5-20251001',
  // Default fallback
  default: 'claude-haiku-4-5-20251001',
};

const REDUCED_MAX_TURNS = 10;

/**
 * Self-healing strategy for agent timeouts.
 *
 * detect(): recognizes 'Idle timeout:' / 'Total timeout:' errors from base-agent.js.
 * diagnose(): identifies which agent timed out and which faster model to use.
 * heal(): re-runs the agent action with a faster model and reduced maxTurns.
 */
export const agentTimeoutStrategy = {
  name: 'agent-timeout',

  /**
   * @param {{ errorMessage: string }} errorContext
   * @returns {boolean}
   */
  detect(errorContext) {
    const { errorMessage } = errorContext;
    if (!errorMessage) return false;
    return TIMEOUT_PATTERNS.some(p => p.test(errorMessage));
  },

  /**
   * @param {{ errorMessage: string, agentName?: string, model?: string }} errorContext
   * @returns {{ agentName: string, originalModel: string, fasterModel: string, reducedMaxTurns: number }}
   */
  diagnose(errorContext) {
    const { agentName = 'UNKNOWN', model } = errorContext;
    const originalModel = model || config.modelCoder || 'claude-sonnet-4-6';

    // Pick faster fallback model
    const modelKey = Object.keys(FASTER_MODEL_FALLBACKS).find(k => originalModel.includes(k));
    const fasterModel = modelKey ? FASTER_MODEL_FALLBACKS[modelKey] : FASTER_MODEL_FALLBACKS.default;

    return {
      agentName,
      originalModel,
      fasterModel,
      reducedMaxTurns: REDUCED_MAX_TURNS,
    };
  },

  /**
   * Re-run the agent action with a faster model and reduced maxTurns.
   *
   * @param {{ errorMessage: string, agentName?: string, model?: string, action?: (opts: object) => Promise<any> }} errorContext
   * @returns {Promise<{ healed: boolean, fasterModel: string, result?: any }>}
   */
  async heal(errorContext) {
    const { action } = errorContext;
    const diagnosis = this.diagnose(errorContext);
    const { agentName, fasterModel, reducedMaxTurns } = diagnosis;

    if (typeof action !== 'function') {
      return { healed: false, fasterModel, reason: 'no-action-provided' };
    }

    logger.info(
      `Self-healing agent timeout: retrying ${agentName} with model=${fasterModel}, maxTurns=${reducedMaxTurns}`,
      'SELF-HEALING',
    );

    try {
      const result = await action({ model: fasterModel, maxTurns: reducedMaxTurns });
      return { healed: true, fasterModel, result };
    } catch (err) {
      logger.warn(`Self-healing agent timeout: retry also failed — ${err.message}`, 'SELF-HEALING');
      return { healed: false, fasterModel };
    }
  },
};
