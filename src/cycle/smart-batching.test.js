import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('../agents/planner.js', () => ({
  fetchProjectTasks: vi.fn(),
  filterBlockedTasks: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    smartBatching: true,
    batchMaxTasks: 5,
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
  },
  EVENT_TYPES: {
    BATCH_PREPARED: 'batch:prepared',
    BATCH_TASK_COMPLETE: 'batch:task:complete',
    BATCH_COMPLETE: 'batch:complete',
    BATCH_TASK_SEPARATED: 'batch:task:separated',
  },
}));

import {
  detectTrivialTasks,
  groupBatch,
  buildBatchBranchName,
  buildBatchPR,
  separateRejectedTasks,
  prepareBatch,
} from './smart-batching.js';
import { fetchProjectTasks, filterBlockedTasks } from '../agents/planner.js';
import { config } from '../config.js';
import { eventBus } from '../events/event-bus.js';

// ── Helper: create fake tasks ──

function makeTask(overrides = {}) {
  return {
    id: overrides.id || 'task-1',
    title: overrides.title || 'Fix typo',
    status: overrides.status || 'to-do',
    devPoints: overrides.devPoints ?? 1,
    projectId: overrides.projectId || 'proj-1',
    sprintId: overrides.sprintId || 'sprint-1',
    blockedBy: overrides.blockedBy || [],
    ...overrides,
  };
}

describe('smart-batching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.smartBatching = true;
    config.batchMaxTasks = 5;
  });

  // ── detectTrivialTasks ──

  describe('detectTrivialTasks', () => {
    it('returns trivial unblocked tasks (devPoints <= 2)', async () => {
      const tasks = [
        makeTask({ id: 't1', devPoints: 1, status: 'to-do' }),
        makeTask({ id: 't2', devPoints: 2, status: 'to-do' }),
        makeTask({ id: 't3', devPoints: 5, status: 'to-do' }),
        makeTask({ id: 't4', devPoints: 1, status: 'done' }),
      ];

      fetchProjectTasks.mockResolvedValue(tasks);
      filterBlockedTasks.mockReturnValue({
        eligible: [tasks[0], tasks[1], tasks[2]],
        blocked: [],
      });

      const result = await detectTrivialTasks('proj-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('t1');
      expect(result[1].id).toBe('t2');
    });

    it('returns empty when no to-do tasks exist', async () => {
      fetchProjectTasks.mockResolvedValue([
        makeTask({ id: 't1', status: 'done' }),
      ]);

      const result = await detectTrivialTasks('proj-1');
      expect(result).toHaveLength(0);
    });

    it('excludes tasks with devPoints 0', async () => {
      const tasks = [
        makeTask({ id: 't1', devPoints: 0, status: 'to-do' }),
        makeTask({ id: 't2', devPoints: 1, status: 'to-do' }),
      ];

      fetchProjectTasks.mockResolvedValue(tasks);
      filterBlockedTasks.mockReturnValue({
        eligible: tasks,
        blocked: [],
      });

      const result = await detectTrivialTasks('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t2');
    });
  });

  // ── groupBatch ──

  describe('groupBatch', () => {
    it('groups 3 trivial tasks into a batch', () => {
      const tasks = [
        makeTask({ id: 't1' }),
        makeTask({ id: 't2' }),
        makeTask({ id: 't3' }),
      ];

      const result = groupBatch(tasks);

      expect(result.shouldBatch).toBe(true);
      expect(result.batch).toHaveLength(3);
      expect(result.reason).toContain('3 trivial tasks');
    });

    it('returns shouldBatch=false when only 1 task', () => {
      const result = groupBatch([makeTask()]);

      expect(result.shouldBatch).toBe(false);
      expect(result.batch).toHaveLength(0);
    });

    it('returns shouldBatch=false when no tasks', () => {
      const result = groupBatch([]);

      expect(result.shouldBatch).toBe(false);
    });

    it('respects maxTasks limit', () => {
      const tasks = Array.from({ length: 8 }, (_, i) =>
        makeTask({ id: `t${i}` })
      );

      const result = groupBatch(tasks, { maxTasks: 3 });

      expect(result.shouldBatch).toBe(true);
      expect(result.batch).toHaveLength(3);
    });

    it('uses config.batchMaxTasks as default limit', () => {
      config.batchMaxTasks = 2;

      const tasks = [
        makeTask({ id: 't1' }),
        makeTask({ id: 't2' }),
        makeTask({ id: 't3' }),
      ];

      const result = groupBatch(tasks);

      expect(result.batch).toHaveLength(2);
    });
  });

  // ── buildBatchBranchName ──

  describe('buildBatchBranchName', () => {
    it('builds branch name from sprint ID', () => {
      expect(buildBatchBranchName('sprint-1')).toBe('batch/sprint-1-trivial-fixes');
    });

    it('uses "general" when no sprint provided', () => {
      expect(buildBatchBranchName()).toBe('batch/general-trivial-fixes');
      expect(buildBatchBranchName(null)).toBe('batch/general-trivial-fixes');
    });

    it('sanitizes special characters in sprint ID', () => {
      expect(buildBatchBranchName('Sprint #3!')).toBe('batch/sprint--3--trivial-fixes');
    });
  });

  // ── buildBatchPR ──

  describe('buildBatchPR', () => {
    it('builds PR title and body for a batch', () => {
      const batch = [
        makeTask({ id: 't1', title: 'Fix typo in README', devPoints: 1 }),
        makeTask({ id: 't2', title: 'Update package version', devPoints: 2 }),
        makeTask({ id: 't3', title: 'Remove dead import', devPoints: 1 }),
      ];

      const { title, body } = buildBatchPR(batch);

      expect(title).toBe('Batch: 3 trivial fixes');
      expect(body).toContain('Fix typo in README');
      expect(body).toContain('Update package version');
      expect(body).toContain('Remove dead import');
      expect(body).toContain('Batch of 3 trivial tasks');
    });
  });

  // ── separateRejectedTasks ──

  describe('separateRejectedTasks', () => {
    it('separates rejected tasks from the batch', () => {
      const batch = [
        makeTask({ id: 't1' }),
        makeTask({ id: 't2' }),
        makeTask({ id: 't3' }),
      ];

      const { remaining, separated } = separateRejectedTasks(batch, {
        rejectedTaskIds: ['t2'],
      });

      expect(remaining).toHaveLength(2);
      expect(remaining.map(t => t.id)).toEqual(['t1', 't3']);
      expect(separated).toHaveLength(1);
      expect(separated[0].id).toBe('t2');
    });

    it('returns all tasks as remaining when nothing rejected', () => {
      const batch = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];

      const { remaining, separated } = separateRejectedTasks(batch, {
        rejectedTaskIds: [],
      });

      expect(remaining).toHaveLength(2);
      expect(separated).toHaveLength(0);
    });

    it('handles missing rejectedTaskIds gracefully', () => {
      const batch = [makeTask({ id: 't1' })];

      const { remaining, separated } = separateRejectedTasks(batch, {});

      expect(remaining).toHaveLength(1);
      expect(separated).toHaveLength(0);
    });
  });

  // ── prepareBatch (integration of all pieces) ──

  describe('prepareBatch', () => {
    it('returns null when smartBatching is disabled', async () => {
      config.smartBatching = false;

      const result = await prepareBatch('proj-1');

      expect(result).toBeNull();
    });

    it('returns null when fewer than 2 trivial tasks', async () => {
      fetchProjectTasks.mockResolvedValue([
        makeTask({ id: 't1', devPoints: 1, status: 'to-do' }),
      ]);
      filterBlockedTasks.mockReturnValue({
        eligible: [makeTask({ id: 't1', devPoints: 1 })],
        blocked: [],
      });

      const result = await prepareBatch('proj-1');

      expect(result).toBeNull();
    });

    it('prepares a batch of 3 trivial tasks', async () => {
      const tasks = [
        makeTask({ id: 't1', devPoints: 1, status: 'to-do', sprintId: 'sprint-2' }),
        makeTask({ id: 't2', devPoints: 2, status: 'to-do', sprintId: 'sprint-2' }),
        makeTask({ id: 't3', devPoints: 1, status: 'to-do', sprintId: 'sprint-2' }),
      ];

      fetchProjectTasks.mockResolvedValue(tasks);
      filterBlockedTasks.mockReturnValue({
        eligible: tasks,
        blocked: [],
      });

      const result = await prepareBatch('proj-1');

      expect(result).not.toBeNull();
      expect(result.batch).toHaveLength(3);
      expect(result.branchName).toBe('batch/sprint-2-trivial-fixes');
      expect(result.pr.title).toBe('Batch: 3 trivial fixes');
      expect(result.pr.body).toContain('t1');
      expect(result.pr.body).toContain('t2');
      expect(result.pr.body).toContain('t3');

      // Emits BATCH_PREPARED event
      expect(eventBus.emitEvent).toHaveBeenCalledWith('batch:prepared', {
        metadata: {
          taskCount: 3,
          taskIds: ['t1', 't2', 't3'],
          branchName: 'batch/sprint-2-trivial-fixes',
        },
      });
    });

    it('respects maxTasks override', async () => {
      const tasks = Array.from({ length: 4 }, (_, i) =>
        makeTask({ id: `t${i}`, devPoints: 1, status: 'to-do' })
      );

      fetchProjectTasks.mockResolvedValue(tasks);
      filterBlockedTasks.mockReturnValue({
        eligible: tasks,
        blocked: [],
      });

      const result = await prepareBatch('proj-1', { maxTasks: 2 });

      expect(result.batch).toHaveLength(2);
    });
  });
});
