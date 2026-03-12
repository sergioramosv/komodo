import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { testFailureStrategy } from './strategies/test-failure.js';
import { mergeConflictStrategy } from './strategies/merge-conflict.js';
import { rateLimitStrategy } from './strategies/rate-limit.js';
import { githubApiErrorStrategy } from './strategies/github-api-error.js';
import { agentTimeoutStrategy } from './strategies/agent-timeout.js';
import { firebaseDownStrategy } from './strategies/firebase-down.js';

/**
 * Named strategy identifiers for external reference.
 */
export const HEALING_STRATEGIES = {
  TEST_FAILURE: 'test-failure',
  MERGE_CONFLICT: 'merge-conflict',
  RATE_LIMIT: 'rate-limit',
  GITHUB_API_ERROR: 'github-api-error',
  AGENT_TIMEOUT: 'agent-timeout',
  FIREBASE_DOWN: 'firebase-down',
};

/**
 * Priority-ordered list of healing strategies.
 *
 * Each strategy is tried in order; the first one whose detect() returns true is used.
 */
const STRATEGIES = [
  mergeConflictStrategy,   // merge conflicts are critical blockers
  agentTimeoutStrategy,    // timeouts need fast recovery
  rateLimitStrategy,       // rate limits are common
  githubApiErrorStrategy,  // transient GitHub API errors
  testFailureStrategy,     // test failures need analysis
  firebaseDownStrategy,    // Firebase outages are infrastructure issues
];

/**
 * Central self-healing orchestrator.
 *
 * Receives an errorContext object, iterates strategies in priority order,
 * runs detect() → diagnose() → heal(), and emits lifecycle events.
 */
export const healingEngine = {
  /**
   * Attempt to heal the given error context.
   *
   * @param {{ type?: string, errorMessage: string, [key: string]: any }} errorContext
   * @returns {Promise<{ healed: boolean, strategy: string|null, result?: object }>}
   */
  async attemptHealing(errorContext) {
    const { errorMessage = '' } = errorContext;

    // Find the first matching strategy
    let matchedStrategy = null;

    // If a specific type is requested, use it directly
    if (errorContext.type) {
      matchedStrategy = STRATEGIES.find(s => s.name === errorContext.type);
    }

    // Otherwise auto-detect from error message
    if (!matchedStrategy) {
      matchedStrategy = STRATEGIES.find(s => s.detect(errorContext));
    }

    if (!matchedStrategy) {
      logger.warn(`Self-healing: no strategy matched for error: ${errorMessage.slice(0, 100)}`, 'SELF-HEALING');
      return { healed: false, strategy: null };
    }

    const strategyName = matchedStrategy.name;
    logger.info(`Self-healing: attempting strategy "${strategyName}"`, 'SELF-HEALING');

    eventBus.emitEvent(EVENT_TYPES.SELF_HEALING_ATTEMPTED, {
      metadata: { strategy: strategyName, errorMessage: errorMessage.slice(0, 200) },
    });

    try {
      const result = await matchedStrategy.heal(errorContext);

      if (result.healed) {
        logger.info(`Self-healing: strategy "${strategyName}" succeeded`, 'SELF-HEALING');
        eventBus.emitEvent(EVENT_TYPES.SELF_HEALING_SUCCEEDED, {
          metadata: { strategy: strategyName, action: result.action },
        });
      } else {
        logger.warn(`Self-healing: strategy "${strategyName}" could not heal`, 'SELF-HEALING');
        eventBus.emitEvent(EVENT_TYPES.SELF_HEALING_FAILED, {
          metadata: { strategy: strategyName, action: result.action },
        });
      }

      return { healed: result.healed, strategy: strategyName, result };
    } catch (err) {
      logger.error(`Self-healing: strategy "${strategyName}" threw — ${err.message}`, 'SELF-HEALING');
      eventBus.emitEvent(EVENT_TYPES.SELF_HEALING_FAILED, {
        metadata: { strategy: strategyName, error: err.message },
      });
      return { healed: false, strategy: strategyName };
    }
  },
};
