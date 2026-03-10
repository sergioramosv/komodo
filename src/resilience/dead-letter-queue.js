import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * Dead Letter Queue (DLQ).
 *
 * Tasks that fail repeatedly (3+ times by default) are moved here
 * and marked as 'pending-review', requiring human intervention.
 */
export class DeadLetterQueue {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxRetries] - Max failures before moving to DLQ
   */
  constructor(options = {}) {
    this.maxRetries = options.maxRetries ?? config.deadLetterMaxRetries;

    /** @type {Map<string, number>} taskId → failure count */
    this.failureCounts = new Map();

    /** @type {Map<string, { taskId: string, title: string, errors: string[], queuedAt: string }>} */
    this.queue = new Map();
  }

  /**
   * Record a task failure. Returns true if the task was moved to the DLQ.
   *
   * @param {string} taskId
   * @param {string} taskTitle
   * @param {string} [error] - Error message
   * @returns {boolean} true if task was moved to DLQ (pending-review)
   */
  recordFailure(taskId, taskTitle, error) {
    const count = (this.failureCounts.get(taskId) || 0) + 1;
    this.failureCounts.set(taskId, count);

    if (count >= this.maxRetries && !this.queue.has(taskId)) {
      const entry = {
        taskId,
        title: taskTitle,
        errors: [error || 'unknown error'],
        failureCount: count,
        queuedAt: new Date().toISOString(),
        status: 'pending-review',
      };
      this.queue.set(taskId, entry);

      logger.warn(
        `Task "${taskTitle}" moved to Dead Letter Queue after ${count} failures (pending-review)`,
        'RESILIENCE',
      );

      eventBus.emitEvent(EVENT_TYPES.DEAD_LETTER_QUEUED, {
        metadata: { taskId, title: taskTitle, failureCount: count, error },
      });

      return true;
    }

    // Append error to existing DLQ entry if already queued
    if (this.queue.has(taskId) && error) {
      this.queue.get(taskId).errors.push(error);
      this.queue.get(taskId).failureCount = count;
    }

    return false;
  }

  /**
   * Check if a task is in the DLQ (should be skipped).
   *
   * @param {string} taskId
   * @returns {boolean}
   */
  isDeadLettered(taskId) {
    return this.queue.has(taskId);
  }

  /**
   * Get the failure count for a task.
   *
   * @param {string} taskId
   * @returns {number}
   */
  getFailureCount(taskId) {
    return this.failureCounts.get(taskId) || 0;
  }

  /**
   * Get all dead-lettered tasks.
   *
   * @returns {Array<{ taskId: string, title: string, errors: string[], queuedAt: string, status: string }>}
   */
  getAll() {
    return [...this.queue.values()];
  }

  /**
   * Remove a task from the DLQ (after human review).
   *
   * @param {string} taskId
   */
  remove(taskId) {
    this.queue.delete(taskId);
    this.failureCounts.delete(taskId);
  }

  /**
   * Reset the entire DLQ.
   */
  reset() {
    this.failureCounts.clear();
    this.queue.clear();
  }

  /**
   * Get a snapshot of the DLQ state.
   *
   * @returns {{ count: number, tasks: Array }}
   */
  getSnapshot() {
    return {
      count: this.queue.size,
      tasks: this.getAll(),
    };
  }
}

/** Singleton DLQ instance. */
export const deadLetterQueue = new DeadLetterQueue();
