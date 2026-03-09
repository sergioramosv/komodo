import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig, mockDbRef } = vi.hoisted(() => {
  const mockDbRef = {
    set: vi.fn().mockResolvedValue(undefined),
    once: vi.fn().mockResolvedValue({ val: () => null }),
    transaction: vi.fn().mockImplementation(async (cb) => cb(null)),
  };

  return {
    mockConfig: {
      modelPerformanceTracking: true,
    },
    mockDbRef,
  };
});

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: { MODEL_PERFORMANCE_RECORDED: 'metrics:model-performance:recorded' },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getDb: vi.fn(() => ({
    ref: vi.fn(() => mockDbRef),
  })),
}));

import {
  recordModelPerformance,
  getModelPerformanceAggregates,
  getModelPerformanceTasks,
} from './model-performance-tracker.js';

import { eventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.modelPerformanceTracking = true;
  mockDbRef.set.mockResolvedValue(undefined);
  mockDbRef.once.mockResolvedValue({ val: () => null });
  mockDbRef.transaction.mockImplementation(async (cb) => cb(null));
});

// --- recordModelPerformance ---

describe('recordModelPerformance', () => {
  it('records task and aggregate to Firebase and emits event', async () => {
    const result = await recordModelPerformance({
      taskId: 'task-1',
      projectId: 'proj-1',
      plannerModel: 'claude-opus-4',
      coderModel: 'claude-sonnet-4',
      reviewerModel: 'claude-opus-4',
      reviewScore: 8,
      reviewCycles: 2,
      durationSeconds: 300,
      cost: 0.05,
      approved: true,
    });

    expect(result.recorded).toBe(true);
    expect(mockDbRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        projectId: 'proj-1',
        coderModel: 'claude-sonnet-4',
        reviewScore: 8,
        reviewCycles: 2,
        durationSeconds: 300,
        approved: true,
      }),
    );
    expect(mockDbRef.transaction).toHaveBeenCalled();
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'metrics:model-performance:recorded',
      expect.any(Object),
    );
  });

  it('returns { recorded: false } when modelPerformanceTracking is disabled', async () => {
    mockConfig.modelPerformanceTracking = false;

    const result = await recordModelPerformance({
      taskId: 'task-1',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewScore: 8,
      reviewCycles: 2,
      durationSeconds: 300,
    });

    expect(result.recorded).toBe(false);
    expect(mockDbRef.set).not.toHaveBeenCalled();
  });

  it('returns { recorded: false } when taskId is missing', async () => {
    const result = await recordModelPerformance({
      taskId: '',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewCycles: 2,
      durationSeconds: 300,
    });

    expect(result.recorded).toBe(false);
    expect(mockDbRef.set).not.toHaveBeenCalled();
  });

  it('returns { recorded: false } when projectId is missing', async () => {
    const result = await recordModelPerformance({
      taskId: 'task-1',
      projectId: '',
      coderModel: 'claude-sonnet-4',
      reviewCycles: 2,
      durationSeconds: 300,
    });

    expect(result.recorded).toBe(false);
    expect(mockDbRef.set).not.toHaveBeenCalled();
  });

  it('handles Firebase errors gracefully', async () => {
    mockDbRef.set.mockRejectedValue(new Error('Firebase down'));

    const result = await recordModelPerformance({
      taskId: 'task-1',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewCycles: 2,
      durationSeconds: 300,
    });

    expect(result.recorded).toBe(false);
  });

  it('sanitizes undefined reviewCycles to 0 and logs a warning', async () => {
    const result = await recordModelPerformance({
      taskId: 'task-1',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewScore: null,
      reviewCycles: undefined,
      durationSeconds: 300,
    });

    expect(result.recorded).toBe(true);
    expect(mockDbRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ reviewCycles: 0 }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Non-finite numeric inputs'),
      expect.any(String),
    );
  });

  it('sanitizes NaN durationSeconds to 0 and logs a warning', async () => {
    const result = await recordModelPerformance({
      taskId: 'task-1',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewScore: null,
      reviewCycles: 2,
      durationSeconds: NaN,
    });

    expect(result.recorded).toBe(true);
    expect(mockDbRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 0 }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Non-finite numeric inputs'),
      expect.any(String),
    );
  });

  it('records reviewScore as null when not provided', async () => {
    const result = await recordModelPerformance({
      taskId: 'task-1',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewScore: null,
      reviewCycles: 1,
      durationSeconds: 120,
    });

    expect(result.recorded).toBe(true);
    expect(mockDbRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ reviewScore: null }),
    );
  });

  it('skips aggregate update for roles with empty model strings', async () => {
    const result = await recordModelPerformance({
      taskId: 'task-1',
      projectId: 'proj-1',
      plannerModel: '',
      coderModel: 'claude-sonnet-4',
      reviewerModel: '',
      reviewScore: 7,
      reviewCycles: 1,
      durationSeconds: 200,
    });

    expect(result.recorded).toBe(true);
    // Only one transaction call for coderModel (planner and reviewer are empty)
    expect(mockDbRef.transaction).toHaveBeenCalledTimes(1);
  });
});

// --- Welford incremental average (via transaction callback) ---

describe('Welford incremental average in updateModelAggregate', () => {
  it('initialises aggregate correctly on first entry', async () => {
    let capturedResult;
    mockDbRef.transaction.mockImplementation(async (cb) => {
      capturedResult = cb(null);
    });

    await recordModelPerformance({
      taskId: 'task-1',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewScore: 8,
      reviewCycles: 2,
      durationSeconds: 300,
      cost: 0.1,
    });

    expect(capturedResult).toMatchObject({
      taskCount: 1,
      avgCycles: 2,
      avgDurationSeconds: 300,
      avgScore: 8,
      scoredTaskCount: 1,
      totalCost: 0.1,
    });
  });

  it('updates aggregate correctly for second entry using Welford formula', async () => {
    let capturedResult;
    mockDbRef.transaction.mockImplementation(async (cb) => {
      capturedResult = cb({
        model: 'claude-sonnet-4',
        role: 'coder',
        taskCount: 1,
        avgScore: 8,
        scoredTaskCount: 1,
        avgCycles: 2,
        avgDurationSeconds: 300,
        totalCost: 0.1,
        lastUpdated: '2026-01-01T00:00:00Z',
      });
    });

    await recordModelPerformance({
      taskId: 'task-2',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewScore: 6,
      reviewCycles: 4,
      durationSeconds: 500,
      cost: 0.2,
    });

    // taskCount increments
    expect(capturedResult.taskCount).toBe(2);
    // avgCycles: 2 + (4 - 2) / 2 = 3
    expect(capturedResult.avgCycles).toBeCloseTo(3, 5);
    // avgDurationSeconds: 300 + (500 - 300) / 2 = 400
    expect(capturedResult.avgDurationSeconds).toBeCloseTo(400, 5);
    // scoredCount: 1 + 1 = 2; avgScore: 8 + (6 - 8) / 2 = 7
    expect(capturedResult.scoredTaskCount).toBe(2);
    expect(capturedResult.avgScore).toBeCloseTo(7, 5);
    // totalCost accumulates
    expect(capturedResult.totalCost).toBeCloseTo(0.3, 5);
  });

  it('does not update avgScore when reviewScore is null', async () => {
    let capturedResult;
    mockDbRef.transaction.mockImplementation(async (cb) => {
      capturedResult = cb({
        model: 'claude-sonnet-4',
        role: 'coder',
        taskCount: 1,
        avgScore: 8,
        scoredTaskCount: 1,
        avgCycles: 2,
        avgDurationSeconds: 300,
        totalCost: 0,
        lastUpdated: '2026-01-01T00:00:00Z',
      });
    });

    await recordModelPerformance({
      taskId: 'task-2',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewScore: null,
      reviewCycles: 3,
      durationSeconds: 400,
    });

    // scoredCount unchanged, avgScore unchanged
    expect(capturedResult.scoredTaskCount).toBe(1);
    expect(capturedResult.avgScore).toBeCloseTo(8, 5);
    // taskCount still increments
    expect(capturedResult.taskCount).toBe(2);
  });

  it('separates scoredTaskCount from taskCount when some tasks have no score', async () => {
    let capturedResult;
    mockDbRef.transaction.mockImplementation(async (cb) => {
      capturedResult = cb({
        model: 'claude-sonnet-4',
        role: 'coder',
        taskCount: 2,
        avgScore: 8,
        scoredTaskCount: 1,
        avgCycles: 2,
        avgDurationSeconds: 300,
        totalCost: 0,
        lastUpdated: '2026-01-01T00:00:00Z',
      });
    });

    await recordModelPerformance({
      taskId: 'task-3',
      projectId: 'proj-1',
      coderModel: 'claude-sonnet-4',
      reviewScore: 6,
      reviewCycles: 1,
      durationSeconds: 100,
    });

    // scoredCount: 1 + 1 = 2; avgScore: 8 + (6 - 8) / 2 = 7
    expect(capturedResult.scoredTaskCount).toBe(2);
    expect(capturedResult.avgScore).toBeCloseTo(7, 5);
    // taskCount: 2 + 1 = 3 (includes tasks without score)
    expect(capturedResult.taskCount).toBe(3);
  });
});

// --- getModelPerformanceAggregates ---

describe('getModelPerformanceAggregates', () => {
  it('returns flat list of aggregates from Firebase', async () => {
    const data = {
      'claude-sonnet-4': {
        coder: { model: 'claude-sonnet-4', role: 'coder', taskCount: 5 },
      },
      'claude-opus-4': {
        planner: { model: 'claude-opus-4', role: 'planner', taskCount: 3 },
        reviewer: { model: 'claude-opus-4', role: 'reviewer', taskCount: 3 },
      },
    };
    mockDbRef.once.mockResolvedValue({ val: () => data });

    const result = await getModelPerformanceAggregates('proj-1');

    expect(result).toHaveLength(3);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: 'claude-sonnet-4', role: 'coder' }),
        expect.objectContaining({ model: 'claude-opus-4', role: 'planner' }),
        expect.objectContaining({ model: 'claude-opus-4', role: 'reviewer' }),
      ]),
    );
  });

  it('returns empty array when no data exists', async () => {
    mockDbRef.once.mockResolvedValue({ val: () => null });

    const result = await getModelPerformanceAggregates('proj-1');
    expect(result).toEqual([]);
  });

  it('handles Firebase errors gracefully', async () => {
    mockDbRef.once.mockRejectedValue(new Error('Firebase down'));

    const result = await getModelPerformanceAggregates('proj-1');
    expect(result).toEqual([]);
  });
});

// --- getModelPerformanceTasks ---

describe('getModelPerformanceTasks', () => {
  it('returns list of per-task records from Firebase', async () => {
    const data = {
      'task-1': { taskId: 'task-1', coderModel: 'claude-sonnet-4', reviewCycles: 2 },
      'task-2': { taskId: 'task-2', coderModel: 'claude-opus-4', reviewCycles: 1 },
    };
    mockDbRef.once.mockResolvedValue({ val: () => data });

    const result = await getModelPerformanceTasks('proj-1');

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'task-1' }),
      expect.objectContaining({ taskId: 'task-2' }),
    ]));
  });

  it('returns empty array when no data exists', async () => {
    mockDbRef.once.mockResolvedValue({ val: () => null });

    const result = await getModelPerformanceTasks('proj-1');
    expect(result).toEqual([]);
  });

  it('handles Firebase errors gracefully', async () => {
    mockDbRef.once.mockRejectedValue(new Error('Firebase down'));

    const result = await getModelPerformanceTasks('proj-1');
    expect(result).toEqual([]);
  });
});
