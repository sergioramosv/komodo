import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('./task-runner.js', () => ({
  runTask: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    maxParallel: 3,
    rateLimitCooldownMinutes: 1,
  },
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
    PARALLEL_RUN_START: 'parallel:run:start',
    PARALLEL_RUN_COMPLETE: 'parallel:run:complete',
    PARALLEL_PIPELINE_START: 'parallel:pipeline:start',
    PARALLEL_PIPELINE_COMPLETE: 'parallel:pipeline:complete',
    PARALLEL_PIPELINE_ERROR: 'parallel:pipeline:error',
    PARALLEL_RATE_LIMIT_PAUSE: 'parallel:rate-limit:pause',
    PARALLEL_RATE_LIMIT_RESUME: 'parallel:rate-limit:resume',
    ALL_CLIS_RATE_LIMITED: 'cli:all-rate-limited',
    CLI_RECOVERED: 'cli:recovered',
  },
}));

vi.mock('../agents/fallback-manager.js', () => ({
  fallbackManager: {
    isRateLimited: vi.fn().mockReturnValue(false),
  },
}));

import { selectParallelTasks, tasksShareFiles, runParallel, ParallelDashboard } from './parallel-runner.js';
import { runTask } from './task-runner.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

describe('tasksShareFiles', () => {
  it('returns false when both tasks have no probableFiles', () => {
    expect(tasksShareFiles({}, {})).toBe(false);
  });

  it('returns false when tasks have no overlapping files', () => {
    const a = { probableFiles: ['src/auth.js'] };
    const b = { probableFiles: ['src/users.js'] };
    expect(tasksShareFiles(a, b)).toBe(false);
  });

  it('returns true when tasks share a file', () => {
    const a = { probableFiles: ['src/auth.js', 'src/utils.js'] };
    const b = { probableFiles: ['src/utils.js', 'src/db.js'] };
    expect(tasksShareFiles(a, b)).toBe(true);
  });
});

describe('selectParallelTasks', () => {
  const tasks = [
    { taskId: 't1', title: 'Task 1', blockedBy: [], probableFiles: ['src/a.js'] },
    { taskId: 't2', title: 'Task 2', blockedBy: [], probableFiles: ['src/b.js'] },
    { taskId: 't3', title: 'Task 3', blockedBy: ['t1'], probableFiles: ['src/c.js'] },
    { taskId: 't4', title: 'Task 4', blockedBy: [], probableFiles: ['src/d.js'] },
  ];

  it('returns at most maxParallel tasks', () => {
    const result = selectParallelTasks(tasks, 2);
    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe('t1');
    expect(result[1].taskId).toBe('t2');
  });

  it('excludes tasks with blockedBy dependencies', () => {
    const result = selectParallelTasks(tasks, 4);
    const ids = result.map(t => t.taskId);
    expect(ids).not.toContain('t3');
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
    expect(ids).toContain('t4');
  });

  it('returns single task when maxParallel is 1', () => {
    const result = selectParallelTasks(tasks, 1);
    expect(result).toHaveLength(1);
  });

  it('excludes tasks that share files with already-selected tasks', () => {
    const tasksWithOverlap = [
      { taskId: 't1', title: 'Task 1', blockedBy: [], probableFiles: ['src/shared.js'] },
      { taskId: 't2', title: 'Task 2', blockedBy: [], probableFiles: ['src/shared.js'] },
      { taskId: 't3', title: 'Task 3', blockedBy: [], probableFiles: ['src/other.js'] },
    ];
    const result = selectParallelTasks(tasksWithOverlap, 3);
    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe('t1');
    expect(result[1].taskId).toBe('t3');
  });

  it('returns empty array for empty input', () => {
    expect(selectParallelTasks([], 3)).toEqual([]);
    expect(selectParallelTasks(null, 3)).toEqual([]);
  });
});

describe('ParallelDashboard', () => {
  it('tracks pipeline states', () => {
    const dashboard = new ParallelDashboard();
    dashboard.addPipeline('t1', 'Task 1');
    dashboard.addPipeline('t2', 'Task 2');

    dashboard.updatePipeline('t1', { status: 'running', startedAt: '2026-01-01' });
    dashboard.updatePipeline('t2', { status: 'completed' });

    const snap = dashboard.getSnapshot();
    expect(snap.totalPipelines).toBe(2);
    expect(snap.running).toBe(1);
    expect(snap.completed).toBe(1);
    expect(snap.pipelines.t1.status).toBe('running');
    expect(snap.pipelines.t2.status).toBe('completed');
  });

  it('tracks rate limit paused state', () => {
    const dashboard = new ParallelDashboard();
    expect(dashboard.rateLimitPaused).toBe(false);
    dashboard.rateLimitPaused = true;
    expect(dashboard.getSnapshot().rateLimitPaused).toBe(true);
  });
});

describe('runParallel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs sequentially when maxParallel=1', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1', blockedBy: [] },
    ];

    runTask.mockResolvedValueOnce({
      success: true,
      taskId: 't1',
      taskTitle: 'Task 1',
      prNumber: 10,
    });

    const result = await runParallel(tasks, 'proj-1', { maxParallel: 1 });

    expect(result.tasksCompleted).toBe(1);
    expect(result.tasksFailed).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(1);
  });

  it('runs 3 tasks in parallel simultaneously', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1', blockedBy: [], probableFiles: ['src/a.js'] },
      { taskId: 't2', title: 'Task 2', blockedBy: [], probableFiles: ['src/b.js'] },
      { taskId: 't3', title: 'Task 3', blockedBy: [], probableFiles: ['src/c.js'] },
    ];

    // Track concurrent execution
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    runTask.mockImplementation(() => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;

      return new Promise((resolve) => {
        setTimeout(() => {
          currentConcurrent--;
          resolve({
            success: true,
            taskId: 'task',
            taskTitle: 'Test',
            prNumber: 1,
          });
        }, 50);
      });
    });

    const result = await runParallel(tasks, 'proj-1', { maxParallel: 3 });

    expect(result.tasksCompleted).toBe(3);
    expect(result.tasksFailed).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(3);
    // All 3 should have been running concurrently
    expect(maxConcurrent).toBe(3);
  });

  it('isolates pipeline failures — one failure does not affect others', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1', blockedBy: [], probableFiles: ['src/a.js'] },
      { taskId: 't2', title: 'Task 2', blockedBy: [], probableFiles: ['src/b.js'] },
      { taskId: 't3', title: 'Task 3', blockedBy: [], probableFiles: ['src/c.js'] },
    ];

    let callCount = 0;
    runTask.mockImplementation(() => {
      callCount++;
      const thisCall = callCount;
      return new Promise((resolve) => {
        setTimeout(() => {
          if (thisCall === 2) {
            // Second pipeline fails
            resolve({
              success: false,
              taskId: 't2',
              taskTitle: 'Task 2',
              error: 'Coder failed',
            });
          } else {
            resolve({
              success: true,
              taskId: `t${thisCall}`,
              taskTitle: `Task ${thisCall}`,
              prNumber: thisCall * 10,
            });
          }
        }, 30);
      });
    });

    const result = await runParallel(tasks, 'proj-1', { maxParallel: 3 });

    expect(result.tasksCompleted).toBe(2);
    expect(result.tasksFailed).toBe(1);
    expect(runTask).toHaveBeenCalledTimes(3);
  });

  it('emits parallel run start and complete events', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1', blockedBy: [], probableFiles: ['src/a.js'] },
      { taskId: 't2', title: 'Task 2', blockedBy: [], probableFiles: ['src/b.js'] },
    ];

    runTask.mockResolvedValue({
      success: true,
      taskId: 'task',
      taskTitle: 'Test',
      prNumber: 1,
    });

    await runParallel(tasks, 'proj-1', { maxParallel: 2 });

    const startCalls = eventBus.emitEvent.mock.calls.filter(
      ([type]) => type === EVENT_TYPES.PARALLEL_RUN_START,
    );
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0][1].metadata.totalPipelines).toBe(2);

    const completeCalls = eventBus.emitEvent.mock.calls.filter(
      ([type]) => type === EVENT_TYPES.PARALLEL_RUN_COMPLETE,
    );
    expect(completeCalls).toHaveLength(1);
  });

  it('handles uncaught pipeline exceptions gracefully', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1', blockedBy: [], probableFiles: ['src/a.js'] },
      { taskId: 't2', title: 'Task 2', blockedBy: [], probableFiles: ['src/b.js'] },
    ];

    let callCount = 0;
    runTask.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Unexpected crash'));
      }
      return Promise.resolve({
        success: true,
        taskId: 't2',
        taskTitle: 'Task 2',
        prNumber: 20,
      });
    });

    const result = await runParallel(tasks, 'proj-1', { maxParallel: 2 });

    // One crashed, one succeeded
    expect(result.tasksCompleted).toBe(1);
    expect(result.tasksFailed).toBe(1);
  });

  it('returns dashboard snapshot with per-pipeline progress', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1', blockedBy: [], probableFiles: ['src/a.js'] },
      { taskId: 't2', title: 'Task 2', blockedBy: [], probableFiles: ['src/b.js'] },
    ];

    runTask.mockResolvedValue({
      success: true,
      taskId: 'task',
      taskTitle: 'Test',
      prNumber: 5,
    });

    const result = await runParallel(tasks, 'proj-1', { maxParallel: 2 });

    expect(result.dashboard).not.toBeNull();
    expect(result.dashboard.totalPipelines).toBe(2);
    expect(typeof result.dashboard.pipelines).toBe('object');
  });

  it('registers rate limit listener on event bus', async () => {
    const tasks = [
      { taskId: 't1', title: 'Task 1', blockedBy: [], probableFiles: ['src/a.js'] },
      { taskId: 't2', title: 'Task 2', blockedBy: [], probableFiles: ['src/b.js'] },
    ];

    runTask.mockResolvedValue({
      success: true,
      taskId: 'task',
      taskTitle: 'Test',
      prNumber: 1,
    });

    await runParallel(tasks, 'proj-1', { maxParallel: 2 });

    // Should have registered a listener for ALL_CLIS_RATE_LIMITED
    expect(eventBus.on).toHaveBeenCalledWith(
      EVENT_TYPES.ALL_CLIS_RATE_LIMITED,
      expect.any(Function),
    );

    // Should clean up the listener after completion
    expect(eventBus.removeListener).toHaveBeenCalledWith(
      EVENT_TYPES.ALL_CLIS_RATE_LIMITED,
      expect.any(Function),
    );
  });
});
