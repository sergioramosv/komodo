import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * Circuit breaker states.
 */
export const CB_STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open',
};

/**
 * A circuit breaker for a single service (firebase, github, cli).
 *
 * States:
 * - CLOSED: normal operation, failures are counted
 * - OPEN: too many failures, calls are rejected until cooldown expires
 * - HALF_OPEN: cooldown expired, allowing limited attempts to test recovery
 */
export class CircuitBreaker {
  /**
   * @param {string} name - Service name (firebase, github, cli)
   * @param {Object} [options]
   * @param {number} [options.threshold] - Failures before opening circuit
   * @param {number} [options.cooldownMs] - Cooldown in ms before transitioning to half-open
   * @param {number} [options.halfOpenMaxAttempts] - Max attempts in half-open before re-opening
   */
  constructor(name, options = {}) {
    this.name = name;
    this.threshold = options.threshold || 5;
    this.cooldownMs = options.cooldownMs || 60000;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 2;

    this.state = CB_STATES.CLOSED;
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureAt = null;
    this.openedAt = null;
  }

  /**
   * Check if the circuit allows a call to go through.
   *
   * @returns {boolean} true if the call is allowed
   */
  canExecute() {
    if (this.state === CB_STATES.CLOSED) return true;

    if (this.state === CB_STATES.OPEN) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.cooldownMs) {
        this._transitionTo(CB_STATES.HALF_OPEN);
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow limited attempts
    return this.halfOpenAttempts < this.halfOpenMaxAttempts;
  }

  /**
   * Record a successful call. Resets the circuit to CLOSED if in HALF_OPEN.
   */
  recordSuccess() {
    if (this.state === CB_STATES.HALF_OPEN) {
      this._transitionTo(CB_STATES.CLOSED);
    }
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
  }

  /**
   * Record a failed call. Opens the circuit if threshold is exceeded.
   *
   * @param {string} [error] - Error message for logging
   */
  recordFailure(error) {
    this.lastFailureAt = Date.now();

    if (this.state === CB_STATES.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this._transitionTo(CB_STATES.OPEN);
        logger.warn(`Circuit "${this.name}" re-opened after half-open failures`, 'RESILIENCE');
      }
      return;
    }

    this.failureCount++;

    if (this.failureCount >= this.threshold) {
      this._transitionTo(CB_STATES.OPEN);
      logger.warn(
        `Circuit "${this.name}" opened after ${this.failureCount} failures${error ? `: ${error}` : ''}`,
        'RESILIENCE',
      );
    }
  }

  /**
   * Get a snapshot of the current circuit state.
   *
   * @returns {{ name: string, state: string, failureCount: number, openedAt: number|null }}
   */
  getSnapshot() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      openedAt: this.openedAt,
      lastFailureAt: this.lastFailureAt,
    };
  }

  /**
   * Force-reset the circuit to CLOSED.
   */
  reset() {
    this.state = CB_STATES.CLOSED;
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
  }

  /**
   * @param {string} newState
   * @private
   */
  _transitionTo(newState) {
    const previous = this.state;
    this.state = newState;

    if (newState === CB_STATES.OPEN) {
      this.openedAt = Date.now();
      this.halfOpenAttempts = 0;
      eventBus.emitEvent(EVENT_TYPES.CIRCUIT_OPEN, {
        metadata: { circuit: this.name, failureCount: this.failureCount },
      });
    } else if (newState === CB_STATES.HALF_OPEN) {
      this.halfOpenAttempts = 0;
      eventBus.emitEvent(EVENT_TYPES.CIRCUIT_HALF_OPEN, {
        metadata: { circuit: this.name },
      });
    } else if (newState === CB_STATES.CLOSED) {
      this.failureCount = 0;
      this.openedAt = null;
      eventBus.emitEvent(EVENT_TYPES.CIRCUIT_CLOSED, {
        metadata: { circuit: this.name, previousState: previous },
      });
      logger.success(`Circuit "${this.name}" closed (recovered)`, 'RESILIENCE');
    }
  }
}

/**
 * Pre-configured circuit breakers for Komodo's core services.
 * Each has independent thresholds based on expected reliability.
 */
export const circuits = {
  firebase: new CircuitBreaker('firebase', {
    threshold: config.cbFirebaseThreshold,
    cooldownMs: config.cbCooldownSeconds * 1000,
    halfOpenMaxAttempts: config.cbHalfOpenMaxAttempts,
  }),
  github: new CircuitBreaker('github', {
    threshold: config.cbGithubThreshold,
    cooldownMs: config.cbCooldownSeconds * 1000,
    halfOpenMaxAttempts: config.cbHalfOpenMaxAttempts,
  }),
  cli: new CircuitBreaker('cli', {
    threshold: config.cbCliThreshold,
    cooldownMs: config.cbCooldownSeconds * 1000,
    halfOpenMaxAttempts: config.cbHalfOpenMaxAttempts,
  }),
};
