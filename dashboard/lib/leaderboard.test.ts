import { describe, it, expect } from 'vitest';
import { computeLeaderboard } from './leaderboard';
import type { TaskRecord } from './leaderboard';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: 'task-1',
    plannerModel: 'claude-opus-4',
    coderModel: 'claude-sonnet-4',
    reviewerModel: 'claude-opus-4',
    reviewScore: 8,
    reviewCycles: 1,
    durationSeconds: 120,
    cost: 0.05,
    completedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('computeLeaderboard', () => {
  it('returns empty array for empty tasks', () => {
    expect(computeLeaderboard([], null)).toEqual([]);
  });

  it('creates one row per model+role combination', () => {
    const tasks = [makeTask({ taskId: 'task-1' })];
    const rows = computeLeaderboard(tasks, null);
    // 3 roles × 1 task = 3 rows (planner, coder, reviewer)
    expect(rows).toHaveLength(3);
    const roles = rows.map(r => r.role).sort();
    expect(roles).toEqual(['coder', 'planner', 'reviewer']);
  });

  it('averages scores across multiple tasks', () => {
    const tasks = [
      makeTask({ taskId: 'task-1', plannerModel: 'model-a', reviewScore: 6, reviewCycles: 1 }),
      makeTask({ taskId: 'task-2', plannerModel: 'model-a', reviewScore: 8, reviewCycles: 3 }),
    ];
    const rows = computeLeaderboard(tasks, null);
    const plannerRow = rows.find(r => r.model === 'model-a' && r.role === 'planner');
    expect(plannerRow).toBeDefined();
    expect(plannerRow!.avgScore).toBe(7);
    expect(plannerRow!.avgCycles).toBe(2);
    expect(plannerRow!.taskCount).toBe(2);
  });

  it('returns avgScore = null when no task has a reviewScore', () => {
    const tasks = [
      makeTask({ taskId: 'task-1', reviewScore: null }),
    ];
    const rows = computeLeaderboard(tasks, null);
    for (const row of rows) {
      expect(row.avgScore).toBeNull();
    }
  });

  it('returns avgScore = 0 when reviewScore is actually 0 (not null)', () => {
    const tasks = [
      makeTask({ taskId: 'task-1', plannerModel: 'model-x', reviewScore: 0 }),
    ];
    const rows = computeLeaderboard(tasks, null);
    const plannerRow = rows.find(r => r.model === 'model-x' && r.role === 'planner');
    expect(plannerRow!.avgScore).toBe(0);
  });

  it('filters tasks by allowedTaskIds', () => {
    const tasks = [
      makeTask({ taskId: 'task-1', plannerModel: 'model-a', reviewScore: 9 }),
      makeTask({ taskId: 'task-2', plannerModel: 'model-a', reviewScore: 5 }),
    ];
    const rows = computeLeaderboard(tasks, new Set(['task-1']));
    const plannerRow = rows.find(r => r.model === 'model-a' && r.role === 'planner');
    expect(plannerRow!.avgScore).toBe(9);
    expect(plannerRow!.taskCount).toBe(1);
  });

  it('skips tasks not in allowedTaskIds', () => {
    const tasks = [makeTask({ taskId: 'task-1' })];
    const rows = computeLeaderboard(tasks, new Set(['task-99']));
    expect(rows).toHaveLength(0);
  });

  it('ignores entries with empty model strings', () => {
    const tasks = [makeTask({ taskId: 'task-1', plannerModel: '', coderModel: '', reviewerModel: 'model-r' })];
    const rows = computeLeaderboard(tasks, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('reviewer');
  });

  it('sorts rows by avgScore descending, nulls last', () => {
    const tasks = [
      makeTask({ taskId: 't1', plannerModel: 'low', coderModel: '', reviewerModel: '', reviewScore: 4 }),
      makeTask({ taskId: 't2', plannerModel: 'high', coderModel: '', reviewerModel: '', reviewScore: 9 }),
      makeTask({ taskId: 't3', plannerModel: 'none', coderModel: '', reviewerModel: '', reviewScore: null }),
    ];
    const rows = computeLeaderboard(tasks, null);
    expect(rows[0].model).toBe('high');
    expect(rows[1].model).toBe('low');
    expect(rows[2].model).toBe('none');
    expect(rows[2].avgScore).toBeNull();
  });

  it('converts durationSeconds to minutes', () => {
    const tasks = [makeTask({ taskId: 't1', durationSeconds: 180 })];
    const rows = computeLeaderboard(tasks, null);
    expect(rows[0].avgDurationMinutes).toBe(3);
  });
});
