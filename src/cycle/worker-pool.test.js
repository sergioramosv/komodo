import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./task-runner.js', () => ({
  runTask: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: { maxParallel: 3 },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    logStep: vi.fn(),
    taskHeader: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: vi.fn().mockReturnValue({}),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  },
  EVENT_TYPES: {
    WORKER_STARTED: 'worker:started',
    WORKER_COMPLETED: 'worker:completed',
    WORKER_FAILED: 'worker:failed',
    WORKER_POOL_DRAINED: 'worker-pool:drained',
  },
}));

import { Worker, PriorityQueue, WorkerPool } from './worker-pool.js';
import { runTask } from './task-runner.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

describe('PriorityQueue', () => {
  it('dequeues in FIFO order for same priority', () => {
    const q = new PriorityQueue();
    q.enqueue({ taskId: 'a' }, 0);
    q.enqueue({ taskId: 'b' }, 0);
    q.enqueue({ taskId: 'c' }, 0);

    expect(q.dequeue().taskId).toBe('a');
    expect(q.dequeue().taskId).toBe('b');
    expect(q.dequeue().taskId).toBe('c');
  });

  it('dequeues higher priority first', () => {
    const q = new PriorityQueue();
    q.enqueue({ taskId: 'low' }, 1);
    q.enqueue({ taskId: 'high' }, 10);
    q.enqueue({ taskId: 'mid' }, 5);

    expect(q.dequeue().taskId).toBe('high');
    expect(q.dequeue().taskId).toBe('mid');
    expect(q.dequeue().taskId).toBe('low');
  });

  it('maintains FIFO within same priority level', () => {
    const q = new PriorityQueue();
    q.enqueue({ taskId: 'first-high' }, 10);
    q.enqueue({ taskId: 'low' }, 1);
    q.enqueue({ taskId: 'second-high' }, 10);

    expect(q.dequeue().taskId).toBe('first-high');
    expect(q.dequeue().taskId).toBe('second-high');
    expect(q.dequeue().taskId).toBe('low');
  });

  it('returns null when empty', () => {
    const q = new PriorityQueue();
    expect(q.dequeue()).toBeNull();
    expect(q.peek()).toBeNull();
  });

  it('reports size correctly', () => {
    const q = new PriorityQueue();
    expect(q.size).toBe(0);
    expect(q.isEmpty()).toBe(true);

    q.enqueue({ taskId: 'a' });
    expect(q.size).toBe(1);
    expect(q.isEmpty()).toBe(false);

    q.dequeue();
    expect(q.size).toBe(0);
    expect(q.isEmpty()).toBe(true);
  });

  it('peek returns next item without removing it', () => {
    const q = new PriorityQueue();
    q.enqueue({ taskId: 'a' }, 5);
    q.enqueue({ taskId: 'b' }, 10);

    expect(q.peek().taskId).toBe('b');
    expect(q.size).toBe(2);
  });
});

describe('Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes a task and emits worker:started and worker:completed', async () => {
    runTask.mockResolvedValueOnce({
      success: true,
      taskId: 't1',
      taskTitle: 'Test task',
      prNumber: 42,
    });

    const worker = new Worker(0);
    const events = [];
    worker.on('worker:started', (e) => events.push({ type: 'started', ...e }));
    worker.on('worker:completed', (e) => events.push({ type: 'completed', ...e }));

    const task = { taskId: 't1', title: 'Test task' };
    const result = await worker.execute('proj-1', task);

    expect(result.success).toBe(true);
    expect(worker.busy).toBe(false);
    expect(worker.completedCount).toBe(1);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('started');
    expect(events[1].type).toBe('completed');
  });

  it('emits worker:failed on exception', async () => {
    runTask.mockRejectedValueOnce(new Error('Crash'));

    const worker = new Worker(1);
    const events = [];
    worker.on('worker:failed', (e) => events.push(e));

    const task = { taskId: 't2', title: 'Failing task' };
    const result = await worker.execute('proj-1', task);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Crash');
    expect(worker.failedCount).toBe(1);
    expect(worker.busy).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('emits events to event bus', async () => {
    runTask.mockResolvedValueOnce({ success: true, taskId: 't1' });

    const worker = new Worker(0);
    await worker.execute('proj-1', { taskId: 't1', title: 'Task' });

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.WORKER_STARTED,
      expect.objectContaining({ metadata: expect.objectContaining({ workerId: 0 }) }),
    );
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.WORKER_COMPLETED,
      expect.objectContaining({ metadata: expect.objectContaining({ workerId: 0 }) }),
    );
  });

  it('getStatus returns correct state', async () => {
    const worker = new Worker(3);
    const status = worker.getStatus();

    expect(status.id).toBe(3);
    expect(status.busy).toBe(false);
    expect(status.currentTask).toBeNull();
    expect(status.completedCount).toBe(0);
  });
});

describe('WorkerPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates N workers', () => {
    const pool = new WorkerPool(4);
    expect(pool.workers).toHaveLength(4);
    expect(pool.maxWorkers).toBe(4);
  });

  it('runs tasks across multiple workers concurrently', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1', priority: 0 },
      { taskId: 't2', title: 'Task 2', priority: 0 },
      { taskId: 't3', title: 'Task 3', priority: 0 },
    ];

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    runTask.mockImplementation(() => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
      return new Promise((resolve) => {
        setTimeout(() => {
          currentConcurrent--;
          resolve({ success: true, taskId: 'x', taskTitle: 'X', prNumber: 1 });
        }, 50);
      });
    });

    const pool = new WorkerPool(3);
    const result = await pool.run(tasks, 'proj-1');

    expect(result.completed).toBe(3);
    expect(result.failed).toBe(0);
    expect(maxConcurrent).toBe(3);
  });

  it('respects maxWorkers concurrency limit', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1' },
      { taskId: 't2', title: 'Task 2' },
      { taskId: 't3', title: 'Task 3' },
      { taskId: 't4', title: 'Task 4' },
    ];

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    runTask.mockImplementation(() => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
      return new Promise((resolve) => {
        setTimeout(() => {
          currentConcurrent--;
          resolve({ success: true, taskId: 'x' });
        }, 50);
      });
    });

    const pool = new WorkerPool(2);
    const result = await pool.run(tasks, 'proj-1');

    expect(result.completed).toBe(4);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('processes higher priority tasks first', async () => {
    const executionOrder = [];

    runTask.mockImplementation(() => {
      return Promise.resolve({ success: true, taskId: 'x' });
    });

    const tasks = [
      { taskId: 'low', title: 'Low priority', priority: 1 },
      { taskId: 'high', title: 'High priority', priority: 10 },
      { taskId: 'mid', title: 'Mid priority', priority: 5 },
    ];

    // Use 1 worker to guarantee sequential processing and verify order
    const pool = new WorkerPool(1);

    // Track execution order via worker events
    pool.workers[0].on('worker:started', ({ task }) => {
      executionOrder.push(task.taskId);
    });

    await pool.run(tasks, 'proj-1');

    expect(executionOrder[0]).toBe('high');
    expect(executionOrder[1]).toBe('mid');
    expect(executionOrder[2]).toBe('low');
  });

  it('isolates worker failures — one failure does not affect others', async () => {
    const tasks = [
      { taskId: 't1', title: 'Will succeed' },
      { taskId: 't2', title: 'Will fail' },
      { taskId: 't3', title: 'Will succeed too' },
    ];

    let callCount = 0;
    runTask.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error('Worker crash'));
      }
      return Promise.resolve({ success: true, taskId: `t${callCount}`, prNumber: callCount });
    });

    const pool = new WorkerPool(3);
    const result = await pool.run(tasks, 'proj-1');

    expect(result.completed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(3);
  });

  it('stop() prevents further task dispatching', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1' },
      { taskId: 't2', title: 'Task 2' },
      { taskId: 't3', title: 'Task 3' },
    ];

    let callCount = 0;
    let pool;

    runTask.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Stop the pool after first task starts
        pool.stop();
      }
      return Promise.resolve({ success: true, taskId: `t${callCount}` });
    });

    pool = new WorkerPool(1);
    const result = await pool.run(tasks, 'proj-1');

    expect(pool.running).toBe(false);
    // With 1 worker, stop after first task means queue is cleared
    expect(pool.queue.isEmpty()).toBe(true);
  });

  it('pause() and resume() control dispatching', async () => {
    const pool = new WorkerPool(2);
    pool.running = true;

    pool.pause();
    expect(pool.paused).toBe(true);

    pool.resume();
    expect(pool.paused).toBe(false);
  });

  it('getStatus() returns comprehensive dashboard data', () => {
    const pool = new WorkerPool(2);
    const status = pool.getStatus();

    expect(status.running).toBe(false);
    expect(status.paused).toBe(false);
    expect(status.maxWorkers).toBe(2);
    expect(status.queueSize).toBe(0);
    expect(status.workers).toHaveLength(2);
    expect(status.workers[0].id).toBe(0);
    expect(status.workers[1].id).toBe(1);
  });

  it('emits drained event when all tasks complete', async () => {
    runTask.mockResolvedValue({ success: true, taskId: 'x' });

    const pool = new WorkerPool(2);
    const drainedEvents = [];
    pool.on('drained', (e) => drainedEvents.push(e));

    await pool.run([{ taskId: 't1', title: 'Task 1' }], 'proj-1');

    expect(drainedEvents).toHaveLength(1);
    expect(drainedEvents[0].completed).toBe(1);
  });

  it('emits WORKER_POOL_DRAINED on eventBus', async () => {
    runTask.mockResolvedValue({ success: true, taskId: 'x' });

    const pool = new WorkerPool(1);
    await pool.run([{ taskId: 't1', title: 'Task 1' }], 'proj-1');

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.WORKER_POOL_DRAINED,
      expect.objectContaining({
        metadata: expect.objectContaining({ completed: 1, failed: 0 }),
      }),
    );
  });

  it('handles empty task array', async () => {
    const pool = new WorkerPool(2);
    const result = await pool.run([], 'proj-1');

    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('throws if run() is called while already running', async () => {
    runTask.mockImplementation(() => new Promise(() => {})); // never resolves

    const pool = new WorkerPool(1);
    pool.run([{ taskId: 't1', title: 'T1' }], 'proj-1');

    expect(() => pool.run([{ taskId: 't2', title: 'T2' }], 'proj-1')).toThrow(
      'WorkerPool is already running',
    );

    pool.stop();
  });
});
