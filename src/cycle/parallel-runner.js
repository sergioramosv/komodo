import { runTask } from './task-runner.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { fallbackManager } from '../agents/fallback-manager.js';

/**
 * Checks whether two tasks might touch overlapping files
 * based on their branch names and title heuristics.
 *
 * @param {Object} taskA
 * @param {Object} taskB
 * @returns {boolean} true if tasks likely share files
 */
export function tasksShareFiles(taskA, taskB) {
  // Extract probable file paths from task metadata
  const filesA = new Set(taskA.probableFiles || []);
  const filesB = new Set(taskB.probableFiles || []);

  if (filesA.size === 0 || filesB.size === 0) return false;

  for (const file of filesA) {
    if (filesB.has(file)) return true;
  }
  return false;
}

/**
 * Filters a list of tasks to find those eligible for parallel execution.
 *
 * A task is eligible if:
 * 1. Its blockedBy array is empty (no dependencies)
 * 2. It doesn't share probable files with other selected tasks
 *
 * @param {Object[]} tasks - Array of task objects from the backlog
 * @param {number} maxParallel - Maximum number of parallel pipelines
 * @returns {Object[]} Tasks eligible for parallel execution
 */
export function selectParallelTasks(tasks, maxParallel) {
  if (!tasks || tasks.length === 0) return [];
  if (maxParallel <= 1) return tasks.slice(0, 1);

  // Filter tasks without blockers
  const unblocked = tasks.filter(t => {
    const blockedBy = Array.isArray(t.blockedBy) ? t.blockedBy : [];
    return blockedBy.length === 0;
  });

  const selected = [];

  for (const task of unblocked) {
    if (selected.length >= maxParallel) break;

    // Check that this task doesn't share files with already-selected tasks
    const sharesFiles = selected.some(s => tasksShareFiles(s, task));
    if (!sharesFiles) {
      selected.push(task);
    }
  }

  return selected;
}

/**
 * State of a single pipeline in the parallel runner.
 */
class PipelineState {
  /**
   * @param {string} taskId
   * @param {string} taskTitle
   */
  constructor(taskId, taskTitle) {
    this.taskId = taskId;
    this.taskTitle = taskTitle;
    this.status = 'pending'; // pending | running | completed | failed
    this.startedAt = null;
    this.completedAt = null;
    this.result = null;
    this.error = null;
  }
}

/**
 * Dashboard-friendly snapshot of all parallel pipelines.
 */
export class ParallelDashboard {
  constructor() {
    /** @type {Map<string, PipelineState>} */
    this._pipelines = new Map();
    /** @type {boolean} */
    this.rateLimitPaused = false;
  }

  addPipeline(taskId, taskTitle) {
    this._pipelines.set(taskId, new PipelineState(taskId, taskTitle));
  }

  updatePipeline(taskId, updates) {
    const pipeline = this._pipelines.get(taskId);
    if (pipeline) {
      Object.assign(pipeline, updates);
    }
  }

  getSnapshot() {
    const pipelines = {};
    for (const [id, state] of this._pipelines) {
      pipelines[id] = { ...state };
    }
    return {
      pipelines,
      totalPipelines: this._pipelines.size,
      running: [...this._pipelines.values()].filter(p => p.status === 'running').length,
      completed: [...this._pipelines.values()].filter(p => p.status === 'completed').length,
      failed: [...this._pipelines.values()].filter(p => p.status === 'failed').length,
      rateLimitPaused: this.rateLimitPaused,
    };
  }
}

/**
 * Runs a single pipeline (one task through the full cycle).
 * Isolated: errors don't propagate to other pipelines.
 *
 * @param {string} projectId
 * @param {Object} task - Task spec with taskId, title, etc.
 * @param {ParallelDashboard} dashboard
 * @param {string} [cwd]
 * @returns {Promise<Object>} Task result
 */
async function runPipeline(projectId, task, dashboard, cwd) {
  const { taskId, title } = task;

  dashboard.updatePipeline(taskId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  eventBus.emitEvent(EVENT_TYPES.PARALLEL_PIPELINE_START, {
    metadata: { taskId, title },
  });

  try {
    const result = await runTask(projectId, cwd);

    const completedAt = new Date().toISOString();

    if (result.success) {
      dashboard.updatePipeline(taskId, {
        status: 'completed',
        completedAt,
        result,
      });

      eventBus.emitEvent(EVENT_TYPES.PARALLEL_PIPELINE_COMPLETE, {
        metadata: { taskId, title, success: true, prNumber: result.prNumber },
      });
    } else {
      dashboard.updatePipeline(taskId, {
        status: 'failed',
        completedAt,
        error: result.error,
        result,
      });

      eventBus.emitEvent(EVENT_TYPES.PARALLEL_PIPELINE_ERROR, {
        metadata: { taskId, title, error: result.error },
      });
    }

    return result;
  } catch (err) {
    dashboard.updatePipeline(taskId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: err.message,
    });

    eventBus.emitEvent(EVENT_TYPES.PARALLEL_PIPELINE_ERROR, {
      metadata: { taskId, title, error: err.message },
    });

    return {
      success: false,
      taskId,
      taskTitle: title,
      error: err.message,
    };
  }
}

/**
 * Wait until the rate limit pause is resolved.
 * Listens for CLI recovery events to resume.
 *
 * @param {ParallelDashboard} dashboard
 * @returns {Promise<void>}
 */
function waitForRateLimitRecovery(dashboard) {
  return new Promise((resolve) => {
    const handler = () => {
      dashboard.rateLimitPaused = false;

      eventBus.emitEvent(EVENT_TYPES.PARALLEL_RATE_LIMIT_RESUME, {
        metadata: { timestamp: new Date().toISOString() },
      });

      logger.info('Rate limit recovered, resuming parallel execution', 'KOMODO');
      resolve();
    };

    // Listen for any CLI recovery
    eventBus.once(EVENT_TYPES.CLI_RECOVERED, handler);

    // Also set a maximum wait time (use cooldown from config)
    const maxWait = (config.rateLimitCooldownMinutes || 15) * 60 * 1000;
    setTimeout(() => {
      eventBus.removeListener(EVENT_TYPES.CLI_RECOVERED, handler);
      dashboard.rateLimitPaused = false;
      resolve();
    }, maxWait);
  });
}

/**
 * Runs multiple independent tasks in parallel.
 *
 * Each task gets its own pipeline with independent branch/PR/review cycle.
 * If a pipeline fails, it does not affect others.
 * Rate limit detection pauses all pipelines sharing the affected CLI.
 *
 * @param {Object[]} tasks - Array of task objects to run in parallel
 * @param {string} projectId
 * @param {Object} [options]
 * @param {string} [options.cwd] - Working directory
 * @param {number} [options.maxParallel] - Override MAX_PARALLEL config
 * @returns {Promise<{
 *   results: Object[],
 *   dashboard: Object,
 *   tasksCompleted: number,
 *   tasksFailed: number,
 * }>}
 */
export async function runParallel(tasks, projectId, options = {}) {
  const maxParallel = options.maxParallel || config.maxParallel || 1;
  const cwd = options.cwd;

  // If maxParallel is 1 or only 1 task, run sequentially (backward compatible)
  if (maxParallel <= 1 || tasks.length <= 1) {
    const results = [];
    for (const task of tasks) {
      const result = await runTask(projectId, cwd);
      results.push(result);
    }
    return {
      results,
      dashboard: null,
      tasksCompleted: results.filter(r => r.success).length,
      tasksFailed: results.filter(r => !r.success).length,
    };
  }

  const eligible = selectParallelTasks(tasks, maxParallel);
  const dashboard = new ParallelDashboard();

  // Initialize pipeline states
  for (const task of eligible) {
    dashboard.addPipeline(task.taskId, task.title);
  }

  logger.taskHeader(`PARALLEL EXECUTION: ${eligible.length} pipelines`);
  eligible.forEach((t, i) => {
    logger.info(`Pipeline ${i + 1}: "${t.title}" (${t.taskId})`, 'KOMODO');
  });

  eventBus.emitEvent(EVENT_TYPES.PARALLEL_RUN_START, {
    metadata: {
      totalPipelines: eligible.length,
      tasks: eligible.map(t => ({ taskId: t.taskId, title: t.title })),
    },
  });

  // Set up rate limit listener
  let rateLimitCleanup = null;
  const rateLimitHandler = () => {
    if (!dashboard.rateLimitPaused) {
      dashboard.rateLimitPaused = true;
      logger.warn('Rate limit detected — all pipelines will pause at next checkpoint', 'KOMODO');

      eventBus.emitEvent(EVENT_TYPES.PARALLEL_RATE_LIMIT_PAUSE, {
        metadata: { timestamp: new Date().toISOString() },
      });
    }
  };

  eventBus.on(EVENT_TYPES.ALL_CLIS_RATE_LIMITED, rateLimitHandler);
  rateLimitCleanup = () => {
    eventBus.removeListener(EVENT_TYPES.ALL_CLIS_RATE_LIMITED, rateLimitHandler);
  };

  // Run pipelines concurrently with concurrency limit
  const results = [];
  const running = new Set();
  const queue = [...eligible];

  await new Promise((resolveAll) => {
    let doneCount = 0;

    function tryLaunchNext() {
      // Check rate limit pause
      if (dashboard.rateLimitPaused) {
        // Wait for recovery, then continue launching
        waitForRateLimitRecovery(dashboard).then(() => tryLaunchNext());
        return;
      }

      while (running.size < maxParallel && queue.length > 0) {
        const task = queue.shift();

        running.add(task.taskId);

        runPipeline(projectId, task, dashboard, cwd).then((result) => {
          results.push(result);
          running.delete(task.taskId);
          doneCount++;

          // Log progress
          const snap = dashboard.getSnapshot();
          logger.info(
            `Pipeline progress: ${snap.completed} completed, ${snap.failed} failed, ${snap.running} running`,
            'KOMODO',
          );

          if (doneCount >= eligible.length) {
            resolveAll();
          } else {
            tryLaunchNext();
          }
        });
      }

      // All launched but not all done yet — just wait
      if (queue.length === 0 && doneCount >= eligible.length) {
        resolveAll();
      }
    }

    tryLaunchNext();
  });

  // Clean up rate limit listener
  if (rateLimitCleanup) rateLimitCleanup();

  const snap = dashboard.getSnapshot();

  logger.taskHeader('PARALLEL EXECUTION COMPLETE');
  logger.info(`Total pipelines: ${snap.totalPipelines}`, 'KOMODO');
  logger.info(`Completed: ${snap.completed}`, 'KOMODO');
  logger.info(`Failed: ${snap.failed}`, 'KOMODO');

  eventBus.emitEvent(EVENT_TYPES.PARALLEL_RUN_COMPLETE, {
    metadata: {
      totalPipelines: snap.totalPipelines,
      completed: snap.completed,
      failed: snap.failed,
      results: results.map(r => ({
        taskId: r.taskId,
        success: r.success,
        prNumber: r.prNumber || null,
      })),
    },
  });

  return {
    results,
    dashboard: snap,
    tasksCompleted: snap.completed,
    tasksFailed: snap.failed,
  };
}
