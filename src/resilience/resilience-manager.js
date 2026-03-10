import { circuits, CB_STATES } from './circuit-breaker.js';
import { errorBudget } from './error-budget.js';
import { deadLetterQueue } from './dead-letter-queue.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * Resilience Manager — unified facade for circuit breakers, error budget,
 * and dead letter queue.
 *
 * Listens for error-budget:exhausted to auto-pause Komodo and notify the user.
 */
class ResilienceManager {
  constructor() {
    this._unsubscribe = null;
  }

  /**
   * Start listening for resilience events.
   * Call once at orchestrator startup.
   */
  start() {
    if (!config.circuitBreakerEnabled) {
      logger.info('Circuit breaker disabled by config', 'RESILIENCE');
      return;
    }

    this._unsubscribe = eventBus.on(EVENT_TYPES.ERROR_BUDGET_EXHAUSTED, (payload) => {
      const { failureRate, maxFailureRate } = payload.metadata;
      logger.error(
        `Komodo paused: error budget exhausted (${(failureRate * 100).toFixed(0)}% > ${(maxFailureRate * 100).toFixed(0)}%). Requires manual review.`,
        'KOMODO',
      );
      komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
    });

    logger.info('Resilience manager started', 'RESILIENCE');
  }

  /**
   * Stop listening for resilience events.
   */
  stop() {
    if (this._unsubscribe) {
      eventBus.removeListener(EVENT_TYPES.ERROR_BUDGET_EXHAUSTED, this._unsubscribe);
      this._unsubscribe = null;
    }
  }

  /**
   * Check if a service circuit is available.
   *
   * @param {'firebase'|'github'|'cli'} service
   * @returns {boolean}
   */
  canExecute(service) {
    if (!config.circuitBreakerEnabled) return true;
    const circuit = circuits[service];
    if (!circuit) return true;
    return circuit.canExecute();
  }

  /**
   * Record a successful operation for a service.
   *
   * @param {'firebase'|'github'|'cli'} service
   */
  recordSuccess(service) {
    if (!config.circuitBreakerEnabled) return;
    const circuit = circuits[service];
    if (circuit) circuit.recordSuccess();
    errorBudget.record(true);
  }

  /**
   * Record a failed operation for a service.
   *
   * @param {'firebase'|'github'|'cli'} service
   * @param {string} [error] - Error message
   */
  recordFailure(service, error) {
    if (!config.circuitBreakerEnabled) return;
    const circuit = circuits[service];
    if (circuit) circuit.recordFailure(error);
    errorBudget.record(false);
  }

  /**
   * Record a task failure and check if it should be dead-lettered.
   *
   * @param {string} taskId
   * @param {string} taskTitle
   * @param {string} [error]
   * @returns {boolean} true if task was moved to DLQ
   */
  recordTaskFailure(taskId, taskTitle, error) {
    return deadLetterQueue.recordFailure(taskId, taskTitle, error);
  }

  /**
   * Check if a task is dead-lettered (should be skipped).
   *
   * @param {string} taskId
   * @returns {boolean}
   */
  isTaskDeadLettered(taskId) {
    return deadLetterQueue.isDeadLettered(taskId);
  }

  /**
   * Check if the error budget is exhausted.
   *
   * @returns {boolean}
   */
  isErrorBudgetExhausted() {
    return errorBudget.exhausted;
  }

  /**
   * Get a complete snapshot of all resilience state.
   *
   * @returns {{ circuits: Object, errorBudget: Object, deadLetterQueue: Object }}
   */
  getSnapshot() {
    return {
      enabled: config.circuitBreakerEnabled,
      circuits: {
        firebase: circuits.firebase.getSnapshot(),
        github: circuits.github.getSnapshot(),
        cli: circuits.cli.getSnapshot(),
      },
      errorBudget: errorBudget.getSnapshot(),
      deadLetterQueue: deadLetterQueue.getSnapshot(),
    };
  }

  /**
   * Reset all resilience state (circuits, error budget, DLQ).
   */
  reset() {
    circuits.firebase.reset();
    circuits.github.reset();
    circuits.cli.reset();
    errorBudget.reset();
    deadLetterQueue.reset();
  }
}

/** Singleton resilience manager. */
export const resilienceManager = new ResilienceManager();
