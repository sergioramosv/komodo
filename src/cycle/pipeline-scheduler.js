/**
 * PipelineScheduler — inter-task parallelism for Komodo.
 *
 * Allows multiple tasks to advance through the pipeline simultaneously
 * at different stages. While Task 1 is in Review, Task 2 can be in
 * Coding, Task 3 in Planning, etc.
 *
 * Key components:
 *   - CliSlotManager: ensures no two tasks use the same CLI at the same stage
 *   - PipelineScheduler: orchestrates concurrent task execution with the above constraints
 */

import { runTask } from './task-runner.js';
import { selectParallelTasks } from './parallel-runner.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { fallbackManager } from '../agents/fallback-manager.js';
import { detectParallelConflicts } from '../canary/conflict-detector.js';

const AGENT = 'PIPELINE-SCHEDULER';

// ═══════════════════════════════════════════
// CLI SLOT MANAGER
// ═══════════════════════════════════════════

/**
 * Manages CLI slots per pipeline stage.
 *
 * Contract:
 *   - acquire(stage, cli) → Promise that resolves when the slot is free.
 *   - release(stage, cli) → frees the slot and wakes the next waiter.
 *
 * If cli is null/undefined the call is a no-op (non-parallel mode).
 */
export class CliSlotManager {
  constructor() {
    /**
     * Map<slotKey, { owner: string | null, queue: Array<{ resolve: Function }> }>
     * slotKey = `${stage}:${cli}`
     */
    this._slots = new Map();
  }

  /**
   * @param {string} stage  - e.g. 'planning', 'architecting', 'coding', 'reviewing'
   * @param {string} cli    - e.g. 'claude', 'codex'
   * @param {string} taskId - used for logging/events
   */
  async acquire(stage, cli, taskId = '?') {
    if (!stage || !cli) return;

    const key = `${stage}:${cli}`;
    if (!this._slots.has(key)) {
      this._slots.set(key, { owner: null, queue: [] });
    }

    const slot = this._slots.get(key);

    if (slot.owner === null) {
      slot.owner = taskId;
      logger.debug(`[slot] acquired ${key} by task ${taskId}`, AGENT);
      eventBus.emitEvent(EVENT_TYPES.CLI_SLOT_ACQUIRED, {
        metadata: { stage, cli, taskId },
      });
      return;
    }

    // Slot busy — wait
    logger.debug(`[slot] task ${taskId} waiting for ${key} (held by ${slot.owner})`, AGENT);
    eventBus.emitEvent(EVENT_TYPES.PIPELINE_SCHEDULER_STAGE_WAITING, {
      metadata: { stage, cli, taskId, blockedBy: slot.owner },
    });

    await new Promise(resolve => {
      slot.queue.push({ resolve, taskId });
    });

    // We've been woken — take ownership
    slot.owner = taskId;
    logger.debug(`[slot] acquired ${key} by task ${taskId} (from queue)`, AGENT);
    eventBus.emitEvent(EVENT_TYPES.PIPELINE_SCHEDULER_STAGE_ACQUIRED, {
      metadata: { stage, cli, taskId },
    });
    eventBus.emitEvent(EVENT_TYPES.CLI_SLOT_ACQUIRED, {
      metadata: { stage, cli, taskId },
    });
  }

  /**
   * @param {string} stage
   * @param {string} cli
   * @param {string} taskId
   */
  release(stage, cli, taskId = '?') {
    if (!stage || !cli) return;

    const key = `${stage}:${cli}`;
    const slot = this._slots.get(key);
    if (!slot) return;

    logger.debug(`[slot] releasing ${key} by task ${taskId}`, AGENT);
    eventBus.emitEvent(EVENT_TYPES.CLI_SLOT_RELEASED, {
      metadata: { stage, cli, taskId },
    });

    if (slot.queue.length > 0) {
      const next = slot.queue.shift();
      // Wake the next waiter (it will set owner itself in acquire)
      slot.owner = null;
      next.resolve();
    } else {
      slot.owner = null;
    }
  }

  /**
   * Returns true if the given CLI is currently rate limited
   * (delegates to fallbackManager).
   *
   * @param {string} cli
   * @returns {boolean}
   */
  isRateLimited(cli) {
    return fallbackManager.isRateLimited(cli);
  }
}

// ═══════════════════════════════════════════
// PIPELINE SCHEDULER
// ═══════════════════════════════════════════

/**
 * Runs multiple tasks concurrently through the Komodo pipeline.
 *
 * Usage:
 *   const scheduler = new PipelineScheduler();
 *   const results = await scheduler.run(tasks, projectId, { cwd });
 */
export class PipelineScheduler {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxConcurrentAgents] - Override config.maxConcurrentAgents
   */
  constructor(opts = {}) {
    this._maxConcurrent = opts.maxConcurrentAgents ?? config.maxConcurrentAgents;
    this._slotManager = new CliSlotManager();
  }

  /**
   * Runs all tasks concurrently (up to maxConcurrentAgents) and returns
   * an array of task results.
   *
   * @param {Object[]} tasks    - Task specs from the backlog
   * @param {string}   projectId
   * @param {Object}   [opts]
   * @param {string}   [opts.cwd]
   * @returns {Promise<Object[]>}
   */
  async run(tasks, projectId, opts = {}) {
    const { cwd } = opts;

    // Select eligible tasks (file-conflict-free, unblocked)
    const eligible = selectParallelTasks(tasks, this._maxConcurrent);

    logger.info(
      `PipelineScheduler: running ${eligible.length} tasks concurrently (max ${this._maxConcurrent})`,
      AGENT,
    );

    eventBus.emitEvent(EVENT_TYPES.PIPELINE_SCHEDULER_STARTED, {
      metadata: { taskCount: eligible.length, maxConcurrent: this._maxConcurrent },
    });

    const slotManager = this._slotManager;

    const promises = eligible.map(task => {
      eventBus.emitEvent(EVENT_TYPES.PIPELINE_SCHEDULER_TASK_QUEUED, {
        metadata: { taskId: task.taskId, title: task.title },
      });

      return this._runOne(task, projectId, cwd, slotManager);
    });

    const results = await Promise.allSettled(promises);

    const resolved = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      logger.error(`Task ${eligible[i]?.taskId} failed: ${r.reason?.message}`, AGENT);
      return { success: false, taskId: eligible[i]?.taskId, error: r.reason?.message };
    });

    const succeeded = resolved.filter(r => r.success).length;
    const failed = resolved.filter(r => !r.success).length;

    eventBus.emitEvent(EVENT_TYPES.PIPELINE_SCHEDULER_COMPLETE, {
      metadata: { succeeded, failed, total: resolved.length },
    });

    return resolved;
  }

  /**
   * Runs a single task, but the task's taskSpec is already known — we pass it
   * via options.taskSpec to bypass the PLANNING stage internal picker.
   *
   * @private
   */
  async _runOne(task, projectId, cwd, slotManager) {
    try {
      const result = await runTask(projectId, cwd, { slotManager, preselectedTask: task });

      if (result.success) {
        eventBus.emitEvent(EVENT_TYPES.PIPELINE_SCHEDULER_TASK_COMPLETE, {
          metadata: { taskId: result.taskId, title: result.taskTitle },
        });
      } else {
        eventBus.emitEvent(EVENT_TYPES.PIPELINE_SCHEDULER_TASK_FAILED, {
          metadata: { taskId: result.taskId, error: result.error },
        });
      }

      return result;
    } catch (err) {
      eventBus.emitEvent(EVENT_TYPES.PIPELINE_SCHEDULER_TASK_FAILED, {
        metadata: { taskId: task.taskId, error: err.message },
      });
      throw err;
    }
  }

  /**
   * Checks whether a task's filesChanged conflict with any currently active
   * parallel task. Returns the list of conflicts.
   *
   * @param {string}   taskId
   * @param {string[]} filesChanged
   * @returns {{ conflicts: Array<{ conflictingTaskId: string, files: string[] }> }}
   */
  checkFileConflicts(taskId, filesChanged) {
    return detectParallelConflicts(taskId, filesChanged);
  }
}
