import { EventEmitter } from 'events';
import { runTask } from './task-runner.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

/**
 * Represents a single worker that can execute one pipeline at a time.
 */
export class Worker extends EventEmitter {
  /**
   * @param {number} id - Worker index (0-based)
   */
  constructor(id) {
    super();
    this.id = id;
    this.busy = false;
    this.currentTask = null;
    this.completedCount = 0;
    this.failedCount = 0;
  }

  /**
   * Execute a task through the full pipeline.
   *
   * @param {string} projectId
   * @param {Object} task - Task object with taskId, title, priority, etc.
   * @param {string} [cwd]
   * @returns {Promise<Object>} Task result
   */
  async execute(projectId, task, cwd) {
    this.busy = true;
    this.currentTask = task;

    const startTime = Date.now();

    this.emit('worker:started', { workerId: this.id, task });
    eventBus.emitEvent(EVENT_TYPES.WORKER_STARTED, {
      metadata: { workerId: this.id, taskId: task.taskId, title: task.title },
    });

    try {
      const result = await runTask(projectId, cwd);

      this.completedCount++;
      this.busy = false;
      this.currentTask = null;

      const elapsed = Date.now() - startTime;

      this.emit('worker:completed', { workerId: this.id, task, result, elapsed });
      eventBus.emitEvent(EVENT_TYPES.WORKER_COMPLETED, {
        metadata: {
          workerId: this.id,
          taskId: task.taskId,
          title: task.title,
          success: result.success,
          elapsed,
        },
      });

      return result;
    } catch (err) {
      this.failedCount++;
      this.busy = false;
      this.currentTask = null;

      const elapsed = Date.now() - startTime;

      const result = {
        success: false,
        taskId: task.taskId,
        taskTitle: task.title,
        error: err.message,
      };

      this.emit('worker:failed', { workerId: this.id, task, error: err.message, elapsed });
      eventBus.emitEvent(EVENT_TYPES.WORKER_FAILED, {
        metadata: {
          workerId: this.id,
          taskId: task.taskId,
          title: task.title,
          error: err.message,
          elapsed,
        },
      });

      return result;
    }
  }

  getStatus() {
    return {
      id: this.id,
      busy: this.busy,
      currentTask: this.currentTask
        ? { taskId: this.currentTask.taskId, title: this.currentTask.title }
        : null,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
    };
  }
}

/**
 * Priority queue (FIFO within same priority, higher priority first).
 * Priority is numeric — higher value = higher priority.
 */
export class PriorityQueue {
  constructor() {
    /** @type {Array<{task: Object, priority: number}>} */
    this._items = [];
  }

  /**
   * @param {Object} task
   * @param {number} [priority=0]
   */
  enqueue(task, priority = 0) {
    const entry = { task, priority };
    // Insert in sorted position (descending priority, FIFO within same priority)
    let inserted = false;
    for (let i = 0; i < this._items.length; i++) {
      if (this._items[i].priority < priority) {
        this._items.splice(i, 0, entry);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this._items.push(entry);
    }
  }

  dequeue() {
    if (this._items.length === 0) return null;
    return this._items.shift().task;
  }

  get size() {
    return this._items.length;
  }

  isEmpty() {
    return this._items.length === 0;
  }

  peek() {
    if (this._items.length === 0) return null;
    return this._items[0].task;
  }

  toArray() {
    return this._items.map(item => ({
      taskId: item.task.taskId,
      title: item.task.title,
      priority: item.priority,
    }));
  }
}

/**
 * Worker pool with dispatcher and priority queue.
 *
 * - Creates N workers, each capable of running a full pipeline
 * - Dispatcher assigns the next task from the queue to the first free worker
 * - Priority queue: tasks with higher priority are processed first (FIFO within same priority)
 */
export class WorkerPool extends EventEmitter {
  /**
   * @param {number} maxWorkers - Number of workers in the pool
   */
  constructor(maxWorkers) {
    super();
    this.maxWorkers = maxWorkers;
    /** @type {Worker[]} */
    this.workers = [];
    this.queue = new PriorityQueue();
    this.running = false;
    this.paused = false;
    this._results = [];
    this._resolveRun = null;
    this._totalTasks = 0;
    this._processedCount = 0;
    this._projectId = null;
    this._cwd = null;

    for (let i = 0; i < maxWorkers; i++) {
      this.workers.push(new Worker(i));
    }
  }

  /**
   * Run a batch of tasks through the worker pool.
   *
   * @param {Object[]} tasks - Array of task objects with taskId, title, priority
   * @param {string} projectId
   * @param {Object} [options]
   * @param {string} [options.cwd]
   * @returns {Promise<{results: Object[], completed: number, failed: number}>}
   */
  run(tasks, projectId, options = {}) {
    if (this.running) {
      throw new Error('WorkerPool is already running');
    }

    this.running = true;
    this.paused = false;
    this._results = [];
    this._processedCount = 0;
    this._projectId = projectId;
    this._cwd = options.cwd;
    this._totalTasks = tasks.length;

    // Enqueue all tasks with their priority
    for (const task of tasks) {
      const priority = typeof task.priority === 'number' ? task.priority : 0;
      this.queue.enqueue(task, priority);
    }

    logger.taskHeader(`WORKER POOL: ${this.maxWorkers} workers, ${tasks.length} tasks`);

    return new Promise((resolve) => {
      this._resolveRun = resolve;

      if (tasks.length === 0) {
        this._finish();
        return;
      }

      this._dispatch();
    });
  }

  /**
   * Stop the pool — no new tasks will be dispatched.
   * Workers currently executing will finish their current task.
   */
  stop() {
    this.running = false;
    this.paused = false;
    // Clear remaining queue
    while (!this.queue.isEmpty()) {
      this.queue.dequeue();
    }
    logger.info('WorkerPool stopped', 'POOL');
  }

  /**
   * Pause dispatching — running workers continue, but no new tasks are assigned.
   */
  pause() {
    if (!this.running) return;
    this.paused = true;
    logger.info('WorkerPool paused', 'POOL');
  }

  /**
   * Resume dispatching after a pause.
   */
  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    logger.info('WorkerPool resumed', 'POOL');
    this._dispatch();
  }

  /**
   * Get current status of the pool and all workers.
   */
  getStatus() {
    return {
      running: this.running,
      paused: this.paused,
      maxWorkers: this.maxWorkers,
      queueSize: this.queue.size,
      queuedTasks: this.queue.toArray(),
      totalTasks: this._totalTasks,
      processedCount: this._processedCount,
      workers: this.workers.map(w => w.getStatus()),
      results: this._results.map(r => ({
        taskId: r.taskId,
        success: r.success,
        prNumber: r.prNumber || null,
      })),
    };
  }

  /**
   * Internal: dispatch tasks to free workers.
   */
  _dispatch() {
    if (!this.running || this.paused) return;

    for (const worker of this.workers) {
      if (!worker.busy && !this.queue.isEmpty()) {
        const task = this.queue.dequeue();
        this._runWorker(worker, task);
      }
    }
  }

  /**
   * Internal: run a single worker and handle completion.
   */
  async _runWorker(worker, task) {
    logger.info(`Worker ${worker.id} → "${task.title}" (${task.taskId})`, 'POOL');

    const result = await worker.execute(this._projectId, task, this._cwd);
    this._results.push(result);
    this._processedCount++;

    const status = this.getStatus();
    logger.info(
      `Progress: ${status.processedCount}/${status.totalTasks} done, ${status.queueSize} queued`,
      'POOL',
    );

    if (this._processedCount >= this._totalTasks || (!this.running && this.queue.isEmpty())) {
      this._finish();
    } else {
      this._dispatch();
    }
  }

  /**
   * Internal: finalize the run and resolve the promise.
   */
  _finish() {
    this.running = false;
    const completed = this._results.filter(r => r.success).length;
    const failed = this._results.filter(r => !r.success).length;

    logger.taskHeader('WORKER POOL COMPLETE');
    logger.info(`Completed: ${completed}, Failed: ${failed}`, 'POOL');

    eventBus.emitEvent(EVENT_TYPES.WORKER_POOL_DRAINED, {
      metadata: {
        totalTasks: this._totalTasks,
        completed,
        failed,
      },
    });

    this.emit('drained', { results: this._results, completed, failed });

    if (this._resolveRun) {
      this._resolveRun({ results: this._results, completed, failed });
      this._resolveRun = null;
    }
  }
}
