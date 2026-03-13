import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./task-runner.js', () => ({
  runTask: vi.fn(),
}));

vi.mock('./parallel-runner.js', () => ({
  selectParallelTasks: vi.fn((tasks, max) => tasks.slice(0, max)),
}));

vi.mock('../config.js', () => ({
  config: {
    maxConcurrentAgents: 2,
    pipelineScheduler: true,
    cliPlanner: 'claude',
    cliCoder: 'claude',
    cliReviewer: 'claude',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: vi.fn(),
  },
  EVENT_TYPES: {
    CLI_SLOT_ACQUIRED: 'cli-slot:acquired',
    CLI_SLOT_RELEASED: 'cli-slot:released',
    PIPELINE_SCHEDULER_STARTED: 'pipeline-scheduler:started',
    PIPELINE_SCHEDULER_COMPLETE: 'pipeline-scheduler:complete',
    PIPELINE_SCHEDULER_TASK_QUEUED: 'pipeline-scheduler:task:queued',
    PIPELINE_SCHEDULER_STAGE_WAITING: 'pipeline-scheduler:stage:waiting',
    PIPELINE_SCHEDULER_STAGE_ACQUIRED: 'pipeline-scheduler:stage:acquired',
    PIPELINE_SCHEDULER_TASK_COMPLETE: 'pipeline-scheduler:task:complete',
    PIPELINE_SCHEDULER_TASK_FAILED: 'pipeline-scheduler:task:failed',
  },
}));

vi.mock('../agents/fallback-manager.js', () => ({
  fallbackManager: {
    isRateLimited: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../canary/conflict-detector.js', () => ({
  detectParallelConflicts: vi.fn().mockReturnValue({ conflicts: [] }),
}));

import { CliSlotManager, PipelineScheduler } from './pipeline-scheduler.js';
import { runTask } from './task-runner.js';
import { fallbackManager } from '../agents/fallback-manager.js';
import { detectParallelConflicts } from '../canary/conflict-detector.js';

// ═══════════════════════════════════════════
// CliSlotManager
// ═══════════════════════════════════════════

describe('CliSlotManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new CliSlotManager();
    vi.clearAllMocks();
  });

  it('acquires a free slot immediately', async () => {
    await mgr.acquire('coding', 'claude', 'task-1');
    // No error thrown, slot is owned
    expect(mgr._slots.get('coding:claude').owner).toBe('task-1');
  });

  it('releases a slot and clears the owner', () => {
    mgr._slots.set('coding:claude', { owner: 'task-1', queue: [] });
    mgr.release('coding', 'claude', 'task-1');
    expect(mgr._slots.get('coding:claude').owner).toBeNull();
  });

  it('blocks when slot is occupied and resolves after release', async () => {
    const order = [];

    await mgr.acquire('coding', 'claude', 'task-1');
    order.push('task-1 acquired');

    // task-2 tries to acquire the same slot — should wait
    const task2 = mgr.acquire('coding', 'claude', 'task-2').then(() => {
      order.push('task-2 acquired');
    });

    // Release task-1's slot
    mgr.release('coding', 'claude', 'task-1');
    order.push('task-1 released');

    await task2;

    expect(order).toEqual(['task-1 acquired', 'task-1 released', 'task-2 acquired']);
    expect(mgr._slots.get('coding:claude').owner).toBe('task-2');
  });

  it('queues multiple waiters and resolves them in order', async () => {
    const resolved = [];

    await mgr.acquire('reviewing', 'claude', 'task-A');

    const p1 = mgr.acquire('reviewing', 'claude', 'task-B').then(() => resolved.push('B'));
    const p2 = mgr.acquire('reviewing', 'claude', 'task-C').then(() => resolved.push('C'));

    mgr.release('reviewing', 'claude', 'task-A');
    await p1;
    mgr.release('reviewing', 'claude', 'task-B');
    await p2;

    expect(resolved).toEqual(['B', 'C']);
  });

  it('is a no-op when stage or cli is falsy', async () => {
    await expect(mgr.acquire(null, 'claude', 'task-1')).resolves.toBeUndefined();
    await expect(mgr.acquire('coding', null, 'task-1')).resolves.toBeUndefined();
    expect(mgr.release(null, 'claude', 'task-1')).toBeUndefined();
  });

  it('delegates isRateLimited to fallbackManager', () => {
    fallbackManager.isRateLimited.mockReturnValueOnce(true);
    expect(mgr.isRateLimited('claude')).toBe(true);
    expect(fallbackManager.isRateLimited).toHaveBeenCalledWith('claude');
  });
});

// ═══════════════════════════════════════════
// PipelineScheduler
// ═══════════════════════════════════════════

describe('PipelineScheduler', () => {
  const tasks = [
    { taskId: 'task-1', title: 'First', status: 'to-do', blockedBy: [], probableFiles: ['a.js'] },
    { taskId: 'task-2', title: 'Second', status: 'to-do', blockedBy: [], probableFiles: ['b.js'] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    runTask.mockResolvedValue({ success: true, taskId: 'task-1', taskTitle: 'First' });
  });

  it('runs eligible tasks concurrently and returns results', async () => {
    runTask
      .mockResolvedValueOnce({ success: true, taskId: 'task-1', taskTitle: 'First' })
      .mockResolvedValueOnce({ success: true, taskId: 'task-2', taskTitle: 'Second' });

    const scheduler = new PipelineScheduler({ maxConcurrentAgents: 2 });
    const results = await scheduler.run(tasks, 'proj-1', { cwd: '/repo' });

    expect(results).toHaveLength(2);
    expect(results.every(r => r.success)).toBe(true);
    expect(runTask).toHaveBeenCalledTimes(2);
  });

  it('passes slotManager and preselectedTask to runTask', async () => {
    runTask.mockResolvedValue({ success: true, taskId: 'task-1', taskTitle: 'First' });

    const scheduler = new PipelineScheduler({ maxConcurrentAgents: 1 });
    await scheduler.run([tasks[0]], 'proj-1', { cwd: '/repo' });

    expect(runTask).toHaveBeenCalledWith(
      'proj-1',
      '/repo',
      expect.objectContaining({
        slotManager: expect.any(CliSlotManager),
        preselectedTask: tasks[0],
      }),
    );
  });

  it('handles task failures gracefully and returns error results', async () => {
    runTask.mockRejectedValueOnce(new Error('Coder timeout'));

    const scheduler = new PipelineScheduler({ maxConcurrentAgents: 1 });
    const results = await scheduler.run([tasks[0]], 'proj-1', { cwd: '/repo' });

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Coder timeout');
  });

  it('limits concurrency to maxConcurrentAgents via selectParallelTasks', async () => {
    const { selectParallelTasks } = await import('./parallel-runner.js');
    runTask.mockResolvedValue({ success: true, taskId: 'task-1', taskTitle: 'First' });

    const scheduler = new PipelineScheduler({ maxConcurrentAgents: 1 });
    await scheduler.run(tasks, 'proj-1', { cwd: '/repo' });

    expect(selectParallelTasks).toHaveBeenCalledWith(tasks, 1);
    // Only 1 task should have been launched (slice(0, 1))
    expect(runTask).toHaveBeenCalledTimes(1);
  });

  it('checkFileConflicts delegates to detectParallelConflicts', () => {
    const scheduler = new PipelineScheduler();
    scheduler.checkFileConflicts('task-1', ['src/foo.js']);
    // Just verifies the delegation without import cycle issues
    expect(scheduler.checkFileConflicts('task-1', [])).toEqual({ conflicts: [] });
    expect(vi.mocked(detectParallelConflicts)).toHaveBeenCalled();
  });
});
