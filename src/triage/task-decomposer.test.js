import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    taskDecomposition: true,
    decompositionThresholdDevpoints: 8,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: vi.fn().mockReturnValue({}),
  },
  EVENT_TYPES: {
    TASK_DECOMPOSED: 'task:decomposed',
  },
}));

vi.mock('../agents/base-agent.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../utils/parser.js', () => ({
  extractJSON: vi.fn((text) => {
    try { return JSON.parse(text); } catch { return null; }
  }),
}));

import { shouldDecompose, decomposeTask } from './task-decomposer.js';
import { config } from '../config.js';
import { runAgent } from '../agents/base-agent.js';
import { eventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import { extractJSON } from '../utils/parser.js';

describe('task-decomposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.taskDecomposition = true;
    config.decompositionThresholdDevpoints = 8;
  });

  // ── shouldDecompose ──────────────────────────────────

  describe('shouldDecompose', () => {
    it('returns false when TASK_DECOMPOSITION is disabled', () => {
      config.taskDecomposition = false;
      const result = shouldDecompose({ taskId: 't1', devPoints: 13 });
      expect(result.shouldDecompose).toBe(false);
      expect(result.reasons).toContain('TASK_DECOMPOSITION disabled');
    });

    it('returns false when task is already a subtask (has parentTaskId)', () => {
      const result = shouldDecompose({ taskId: 't1', parentTaskId: 'parent-1', devPoints: 13 });
      expect(result.shouldDecompose).toBe(false);
      expect(result.reasons).toContain('Task is already a subtask');
    });

    it('returns false when task is already decomposed', () => {
      const result = shouldDecompose({ taskId: 't1', decomposed: true, devPoints: 13 });
      expect(result.shouldDecompose).toBe(false);
      expect(result.reasons).toContain('Task already decomposed');
    });

    it('returns true when devPoints >= threshold', () => {
      const result = shouldDecompose({ taskId: 't1', devPoints: 8 });
      expect(result.shouldDecompose).toBe(true);
      expect(result.reasons[0]).toContain('devPoints=8');
    });

    it('returns true when acceptance criteria > 6', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 2,
        acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      });
      expect(result.shouldDecompose).toBe(true);
      expect(result.reasons[0]).toContain('acceptanceCriteria=7');
    });

    it('returns true when userStory length > 500 chars', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 2,
        userStory: { who: 'x'.repeat(200), what: 'y'.repeat(200), why: 'z'.repeat(200) },
      });
      expect(result.shouldDecompose).toBe(true);
      expect(result.reasons[0]).toContain('userStoryLength=');
    });

    it('returns false when no thresholds are met', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 3,
        acceptanceCriteria: ['a', 'b'],
        userStory: 'short story',
      });
      expect(result.shouldDecompose).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('returns multiple reasons when multiple thresholds are met', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 13,
        acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        userStory: 'x'.repeat(600),
      });
      expect(result.shouldDecompose).toBe(true);
      expect(result.reasons.length).toBe(3);
    });

    it('handles string acceptanceCriteria (newline-separated)', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 2,
        acceptanceCriteria: 'a\nb\nc\nd\ne\nf\ng\nh',
      });
      expect(result.shouldDecompose).toBe(true);
      expect(result.reasons[0]).toContain('acceptanceCriteria=8');
    });

    it('handles missing/null fields gracefully', () => {
      const result = shouldDecompose({ taskId: 't1' });
      expect(result.shouldDecompose).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });
  });

  // ── getACCount / getStoryLength (tested indirectly) ──

  describe('helpers (via shouldDecompose)', () => {
    it('getACCount returns 0 for null/undefined acceptanceCriteria', () => {
      const result = shouldDecompose({ taskId: 't1', devPoints: 2 });
      expect(result.shouldDecompose).toBe(false);
    });

    it('getACCount counts array length', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 2,
        acceptanceCriteria: new Array(7).fill('criterion'),
      });
      expect(result.shouldDecompose).toBe(true);
      expect(result.reasons[0]).toContain('acceptanceCriteria=7');
    });

    it('getACCount filters empty lines from string', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 2,
        acceptanceCriteria: 'a\n\nb\n\nc',
      });
      // 3 non-empty lines, below threshold of 6
      expect(result.shouldDecompose).toBe(false);
    });

    it('getStoryLength handles string userStory', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 2,
        userStory: 'x'.repeat(501),
      });
      expect(result.shouldDecompose).toBe(true);
      expect(result.reasons[0]).toContain('userStoryLength=501');
    });

    it('getStoryLength handles object userStory', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 2,
        userStory: { who: 'a'.repeat(200), what: 'b'.repeat(200), why: 'c'.repeat(200) },
      });
      expect(result.shouldDecompose).toBe(true);
    });

    it('getStoryLength returns 0 for null userStory', () => {
      const result = shouldDecompose({
        taskId: 't1',
        devPoints: 2,
        userStory: null,
      });
      expect(result.shouldDecompose).toBe(false);
    });
  });

  // ── decomposeTask ──────────────────────────────────

  describe('decomposeTask', () => {
    const baseTask = {
      taskId: 'task-1',
      title: 'Big feature',
      devPoints: 8,
      bizPoints: 5,
      acceptanceCriteria: ['a', 'b', 'c'],
      userStory: { who: 'user', what: 'do things', why: 'reasons' },
      sprintId: 'sprint-1',
    };

    it('returns success with subtaskIds when agent succeeds', async () => {
      runAgent.mockResolvedValue({
        success: true,
        result: { subtaskIds: ['s1', 's2', 's3'], decomposed: true },
      });

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(result.success).toBe(true);
      expect(result.subtaskIds).toEqual(['s1', 's2', 's3']);
      expect(eventBus.emitEvent).toHaveBeenCalledWith('task:decomposed', {
        metadata: {
          parentTaskId: 'task-1',
          parentTitle: 'Big feature',
          subtaskIds: ['s1', 's2', 's3'],
          subtaskCount: 3,
        },
      });
    });

    it('returns error when runAgent throws (try/catch)', async () => {
      runAgent.mockRejectedValue(new Error('Network timeout'));

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Network timeout'),
        'KOMODO',
      );
    });

    it('returns error when agent returns success=false', async () => {
      runAgent.mockResolvedValue({ success: false, error: 'Agent failed' });

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent failed');
    });

    it('returns error when agent returns no result', async () => {
      runAgent.mockResolvedValue({ success: true, result: null });

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent did not return a result');
    });

    it('handles string result by calling extractJSON', async () => {
      const jsonString = JSON.stringify({ subtaskIds: ['s1', 's2'], decomposed: true });
      runAgent.mockResolvedValue({ success: true, result: jsonString });
      extractJSON.mockReturnValue({ subtaskIds: ['s1', 's2'], decomposed: true });

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(extractJSON).toHaveBeenCalledWith(jsonString);
      expect(result.success).toBe(true);
      expect(result.subtaskIds).toEqual(['s1', 's2']);
    });

    it('returns error when string result is not valid JSON', async () => {
      runAgent.mockResolvedValue({ success: true, result: 'not json at all' });
      extractJSON.mockReturnValue(null);

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not valid JSON');
    });

    it('returns error when subtaskIds is missing', async () => {
      runAgent.mockResolvedValue({
        success: true,
        result: { decomposed: true },
      });

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('insufficient or invalid');
    });

    it('returns error when subtaskIds is not an array', async () => {
      runAgent.mockResolvedValue({
        success: true,
        result: { subtaskIds: 'not-array', decomposed: true },
      });

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('insufficient or invalid');
    });

    it('returns error when subtaskIds has fewer than MIN_SUBTASKS', async () => {
      runAgent.mockResolvedValue({
        success: true,
        result: { subtaskIds: ['only-one'], decomposed: true },
      });

      const result = await decomposeTask(baseTask, 'proj-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('insufficient or invalid');
    });

    it('uses defaults when devPoints/bizPoints are missing', async () => {
      runAgent.mockResolvedValue({
        success: true,
        result: { subtaskIds: ['s1', 's2'], decomposed: true },
      });

      const task = { taskId: 'task-2', title: 'No points' };
      const result = await decomposeTask(task, 'proj-1');

      expect(result.success).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('devPoints=5'),
        'KOMODO',
      );
    });
  });
});
