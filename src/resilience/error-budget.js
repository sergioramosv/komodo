import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * Error Budget with sliding window.
 *
 * Tracks success/failure rates over a configurable time window.
 * When the failure rate exceeds maxFailureRate, emits error-budget:exhausted
 * to signal Komodo should pause execution.
 */
export class ErrorBudget {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowMs] - Sliding window size in ms
   * @param {number} [options.maxFailureRate] - Max allowed failure rate (0-1)
   */
  constructor(options = {}) {
    this.windowMs = options.windowMs || config.errorBudgetWindowMinutes * 60 * 1000;
    this.maxFailureRate = options.maxFailureRate ?? config.errorBudgetMaxFailureRate;

    /** @type {Array<{ timestamp: number, success: boolean }>} */
    this.records = [];
    this.exhausted = false;
  }

  /**
   * Record an operation result.
   *
   * @param {boolean} success - Whether the operation succeeded
   */
  record(success) {
    this.records.push({ timestamp: Date.now(), success });
    this._pruneExpired();
    this._checkBudget();
  }

  /**
   * Get current failure rate within the sliding window.
   *
   * @returns {number} Failure rate (0-1), or 0 if no records
   */
  getFailureRate() {
    this._pruneExpired();
    if (this.records.length === 0) return 0;
    const failures = this.records.filter(r => !r.success).length;
    return failures / this.records.length;
  }

  /**
   * Get a snapshot of the current error budget state.
   *
   * @returns {{ failureRate: number, totalRecords: number, exhausted: boolean, windowMs: number, maxFailureRate: number }}
   */
  getSnapshot() {
    return {
      failureRate: this.getFailureRate(),
      totalRecords: this.records.length,
      exhausted: this.exhausted,
      windowMs: this.windowMs,
      maxFailureRate: this.maxFailureRate,
    };
  }

  /**
   * Reset the error budget (e.g. after manual intervention).
   */
  reset() {
    this.records = [];
    this.exhausted = false;
  }

  /**
   * Remove records outside the sliding window.
   * @private
   */
  _pruneExpired() {
    const cutoff = Date.now() - this.windowMs;
    this.records = this.records.filter(r => r.timestamp >= cutoff);
  }

  /**
   * Check if the error budget is exhausted and emit event if so.
   * Requires at least 3 records to avoid false positives on startup.
   * @private
   */
  _checkBudget() {
    if (this.records.length < 3) return;

    const rate = this.getFailureRate();
    if (rate > this.maxFailureRate && !this.exhausted) {
      this.exhausted = true;
      logger.error(
        `Error budget exhausted: failure rate ${(rate * 100).toFixed(0)}% exceeds ${(this.maxFailureRate * 100).toFixed(0)}% threshold`,
        'RESILIENCE',
      );
      eventBus.emitEvent(EVENT_TYPES.ERROR_BUDGET_EXHAUSTED, {
        metadata: {
          failureRate: rate,
          maxFailureRate: this.maxFailureRate,
          totalRecords: this.records.length,
          windowMs: this.windowMs,
        },
      });
    } else if (rate <= this.maxFailureRate && this.exhausted) {
      // Auto-recover when rate drops back below threshold
      this.exhausted = false;
      logger.success('Error budget recovered: failure rate back below threshold', 'RESILIENCE');
    }
  }
}

/** Singleton error budget instance. */
export const errorBudget = new ErrorBudget();
