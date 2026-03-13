import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { saveHealingAttempt } from '../knowledge/knowledge-graph.js';
import { testFailureStrategy } from './strategies/test-failure.js';
import { mergeConflictStrategy } from './strategies/merge-conflict.js';
import { rateLimitStrategy } from './strategies/rate-limit.js';
import { githubApiErrorStrategy } from './strategies/github-api-error.js';
import { agentTimeoutStrategy } from './strategies/agent-timeout.js';
import { firebaseDownStrategy } from './strategies/firebase-down.js';

/** Maximum healing attempts per unique (taskId, errorMessage) key before escalating. */
const MAX_HEALING_ATTEMPTS = 2;

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
  /** Tracks attempt counts per (taskId:errorMessage) key. */
  _attemptCounts: new Map(),

  /**
   * Pipeline entry point: enforces MAX_HEALING_ATTEMPTS per failure key,
   * calls attemptHealing(), persists the result to the Knowledge Graph,
   * and emits SELF_HEAL_RECOVERED or SELF_HEAL_EXHAUSTED.
   *
   * @param {{ taskId?: string, projectId?: string, errorMessage: string, [key: string]: any }} errorContext
   * @returns {Promise<{ healed: boolean, exhausted: boolean, strategy: string|null }>}
   */
  async handleFailure(errorContext) {
    const { taskId, projectId, errorMessage = '' } = errorContext;
    // Use projectId as a scope separator so that services without a taskId
    // don't share the same attempt counter across unrelated projects.
    const scope = taskId ? `task:${taskId}` : `proj:${projectId || 'global'}`;
    const key = `${scope}:${errorMessage.slice(0, 80)}`;
    const count = this._attemptCounts.get(key) || 0;

    if (count >= MAX_HEALING_ATTEMPTS) {
      logger.warn(`Self-healing: max attempts (${MAX_HEALING_ATTEMPTS}) reached for key "${key}"`, 'SELF-HEALING');
      eventBus.emitEvent(EVENT_TYPES.SELF_HEAL_EXHAUSTED, {
        metadata: { taskId, errorMessage: errorMessage.slice(0, 200), attempts: count },
      });
      return { healed: false, exhausted: true, strategy: null };
    }

    this._attemptCounts.set(key, count + 1);

    const result = await this.attemptHealing(errorContext);

    // Persist attempt to Knowledge Graph
    if (taskId && projectId) {
      saveHealingAttempt(projectId, taskId, {
        strategy: result.strategy,
        errorMessage: errorMessage.slice(0, 200),
        healed: result.healed,
        action: result.result?.action ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    if (result.healed) {
      this._attemptCounts.delete(key);
      eventBus.emitEvent(EVENT_TYPES.SELF_HEAL_RECOVERED, {
        metadata: { taskId, strategy: result.strategy, action: result.result?.action },
      });
      return { healed: true, exhausted: false, strategy: result.strategy };
    }

    const newCount = this._attemptCounts.get(key) || 0;
    if (newCount >= MAX_HEALING_ATTEMPTS) {
      logger.warn(`Self-healing: all attempts exhausted for key "${key}"`, 'SELF-HEALING');
      eventBus.emitEvent(EVENT_TYPES.SELF_HEAL_EXHAUSTED, {
        metadata: { taskId, errorMessage: errorMessage.slice(0, 200), attempts: newCount },
      });
      return { healed: false, exhausted: true, strategy: result.strategy };
    }

    return { healed: false, exhausted: false, strategy: result.strategy };
  },

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
