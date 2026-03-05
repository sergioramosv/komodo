import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig, mockDbRef } = vi.hoisted(() => {
  const mockDbRef = {
    set: vi.fn().mockResolvedValue(undefined),
    once: vi.fn().mockResolvedValue({ val: () => null }),
  };

  return {
    mockConfig: {
      estimationTracking: true,
      defaultProjectId: 'proj-1',
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
  EVENT_TYPES: { ESTIMATION_RECORDED: 'estimation:recorded' },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getDb: vi.fn(() => ({
    ref: vi.fn(() => mockDbRef),
  })),
}));

import {
  recordTaskMetrics,
  getTaskMetrics,
  calculateEstimationRatios,
  detectUnderestimatedCategories,
  getEstimationCalibrationContext,
} from './estimation-tracker.js';

import { eventBus } from '../events/event-bus.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.estimationTracking = true;
  mockDbRef.set.mockResolvedValue(undefined);
  mockDbRef.once.mockResolvedValue({ val: () => null });
});

// --- Simulated historical data ---

function makeMetric(overrides = {}) {
  return {
    taskId: 'task-1',
    projectId: 'proj-1',
    estimatedDevPoints: 3,
    totalDurationSeconds: 600,
    reviewCycles: 2,
    approved: true,
    merged: true,
    filesChanged: ['a.js', 'b.js'],
    filesCount: 2,
    model: 'claude',
    completedAt: '2026-03-01T10:00:00Z',
    ...overrides,
  };
}

// --- recordTaskMetrics ---

describe('recordTaskMetrics', () => {
  it('records metrics to Firebase and emits event', async () => {
    const result = await recordTaskMetrics({
      taskId: 'task-1',
      projectId: 'proj-1',
      estimatedDevPoints: 3,
      totalDuration: 600,
      reviewCycles: 2,
      approved: true,
      merged: true,
      filesChanged: ['a.js'],
      model: 'claude',
    });

    expect(result.recorded).toBe(true);
    expect(mockDbRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        projectId: 'proj-1',
        estimatedDevPoints: 3,
        totalDurationSeconds: 600,
        reviewCycles: 2,
      }),
    );
    expect(eventBus.emitEvent).toHaveBeenCalledWith('estimation:recorded', expect.any(Object));
  });

  it('skips when estimationTracking is disabled', async () => {
    mockConfig.estimationTracking = false;

    const result = await recordTaskMetrics({
      taskId: 'task-1',
      projectId: 'proj-1',
      estimatedDevPoints: 3,
      totalDuration: 600,
      reviewCycles: 2,
      approved: true,
      merged: true,
    });

    expect(result.recorded).toBe(false);
    expect(mockDbRef.set).not.toHaveBeenCalled();
  });

  it('returns false when taskId is missing', async () => {
    const result = await recordTaskMetrics({
      taskId: '',
      projectId: 'proj-1',
      estimatedDevPoints: 3,
      totalDuration: 600,
      reviewCycles: 2,
      approved: true,
      merged: true,
    });

    expect(result.recorded).toBe(false);
  });

  it('handles Firebase errors gracefully', async () => {
    mockDbRef.set.mockRejectedValue(new Error('Firebase down'));

    const result = await recordTaskMetrics({
      taskId: 'task-1',
      projectId: 'proj-1',
      estimatedDevPoints: 3,
      totalDuration: 600,
      reviewCycles: 2,
      approved: true,
      merged: true,
    });

    expect(result.recorded).toBe(false);
  });
});

// --- getTaskMetrics ---

describe('getTaskMetrics', () => {
  it('returns metrics from Firebase', async () => {
    const metrics = { t1: makeMetric({ taskId: 't1' }), t2: makeMetric({ taskId: 't2' }) };
    mockDbRef.once.mockResolvedValue({ val: () => metrics });

    const result = await getTaskMetrics('proj-1');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no data', async () => {
    mockDbRef.once.mockResolvedValue({ val: () => null });

    const result = await getTaskMetrics('proj-1');
    expect(result).toEqual([]);
  });

  it('handles errors gracefully', async () => {
    mockDbRef.once.mockRejectedValue(new Error('Firebase down'));

    const result = await getTaskMetrics('proj-1');
    expect(result).toEqual([]);
  });
});

// --- calculateEstimationRatios ---

describe('calculateEstimationRatios', () => {
  it('groups metrics by devPoints range', () => {
    const metrics = [
      makeMetric({ estimatedDevPoints: 1, totalDurationSeconds: 120, reviewCycles: 1, filesCount: 1 }),
      makeMetric({ estimatedDevPoints: 2, totalDurationSeconds: 180, reviewCycles: 1, filesCount: 2 }),
      makeMetric({ estimatedDevPoints: 3, totalDurationSeconds: 600, reviewCycles: 2, filesCount: 3 }),
      makeMetric({ estimatedDevPoints: 5, totalDurationSeconds: 900, reviewCycles: 3, filesCount: 5 }),
      makeMetric({ estimatedDevPoints: 8, totalDurationSeconds: 1800, reviewCycles: 4, filesCount: 8 }),
      makeMetric({ estimatedDevPoints: 13, totalDurationSeconds: 3600, reviewCycles: 5, filesCount: 12 }),
    ];

    const ratios = calculateEstimationRatios(metrics);

    // Trivial: 2 tasks (1pt + 2pt)
    expect(ratios.trivial.taskCount).toBe(2);
    expect(ratios.trivial.avgDuration).toBe(150); // (120+180)/2
    expect(ratios.trivial.avgReviewCycles).toBe(1);

    // Standard: 2 tasks (3pt + 5pt)
    expect(ratios.standard.taskCount).toBe(2);
    expect(ratios.standard.avgDuration).toBe(750); // (600+900)/2
    expect(ratios.standard.avgReviewCycles).toBe(2.5);

    // Complex: 2 tasks (8pt + 13pt)
    expect(ratios.complex.taskCount).toBe(2);
    expect(ratios.complex.avgDuration).toBe(2700); // (1800+3600)/2
    expect(ratios.complex.avgReviewCycles).toBe(4.5);
  });

  it('returns null for empty ranges', () => {
    const metrics = [
      makeMetric({ estimatedDevPoints: 1, totalDurationSeconds: 120, reviewCycles: 1 }),
    ];

    const ratios = calculateEstimationRatios(metrics);
    expect(ratios.trivial.taskCount).toBe(1);
    expect(ratios.standard).toBeNull();
    expect(ratios.complex).toBeNull();
  });

  it('returns all null for empty input', () => {
    const ratios = calculateEstimationRatios([]);
    expect(ratios.trivial).toBeNull();
    expect(ratios.standard).toBeNull();
    expect(ratios.complex).toBeNull();
  });
});

// --- detectUnderestimatedCategories ---

describe('detectUnderestimatedCategories', () => {
  it('warns when avgReviewCycles >= 4 and taskCount >= 3', () => {
    const ratios = {
      trivial: { taskCount: 5, avgDuration: 100, avgReviewCycles: 1.2, avgFilesChanged: 1, avgDevPoints: 1.5 },
      standard: { taskCount: 4, avgDuration: 600, avgReviewCycles: 4.5, avgFilesChanged: 3, avgDevPoints: 3.8 },
      complex: { taskCount: 3, avgDuration: 2000, avgReviewCycles: 5.0, avgFilesChanged: 8, avgDevPoints: 10 },
    };

    const warnings = detectUnderestimatedCategories(ratios);
    expect(warnings).toHaveLength(2);
    expect(warnings[0].range).toBe('standard');
    expect(warnings[1].range).toBe('complex');
  });

  it('does not warn when fewer than 3 tasks', () => {
    const ratios = {
      trivial: null,
      standard: { taskCount: 2, avgDuration: 600, avgReviewCycles: 5.0, avgFilesChanged: 3, avgDevPoints: 4 },
      complex: null,
    };

    const warnings = detectUnderestimatedCategories(ratios);
    expect(warnings).toHaveLength(0);
  });

  it('does not warn when cycles are below threshold', () => {
    const ratios = {
      trivial: { taskCount: 5, avgDuration: 100, avgReviewCycles: 1.0, avgFilesChanged: 1, avgDevPoints: 1 },
      standard: { taskCount: 5, avgDuration: 600, avgReviewCycles: 2.0, avgFilesChanged: 3, avgDevPoints: 3 },
      complex: { taskCount: 5, avgDuration: 2000, avgReviewCycles: 3.0, avgFilesChanged: 8, avgDevPoints: 8 },
    };

    const warnings = detectUnderestimatedCategories(ratios);
    expect(warnings).toHaveLength(0);
  });

  it('handles null ratios', () => {
    const warnings = detectUnderestimatedCategories({ trivial: null, standard: null, complex: null });
    expect(warnings).toEqual([]);
  });
});

// --- getEstimationCalibrationContext ---

describe('getEstimationCalibrationContext', () => {
  it('returns formatted context with historical data', async () => {
    const metrics = {
      t1: makeMetric({ taskId: 't1', estimatedDevPoints: 3, totalDurationSeconds: 600, reviewCycles: 2, filesCount: 3 }),
      t2: makeMetric({ taskId: 't2', estimatedDevPoints: 5, totalDurationSeconds: 900, reviewCycles: 3, filesCount: 5 }),
    };
    mockDbRef.once.mockResolvedValue({ val: () => metrics });

    const result = await getEstimationCalibrationContext('proj-1');

    expect(result.context).toContain('ESTIMATION CALIBRATION');
    expect(result.context).toContain('standard');
    expect(result.warnings).toEqual([]);
    expect(result.ratios.standard).toBeTruthy();
    expect(result.ratios.standard.taskCount).toBe(2);
  });

  it('returns empty when no metrics exist', async () => {
    mockDbRef.once.mockResolvedValue({ val: () => null });

    const result = await getEstimationCalibrationContext('proj-1');
    expect(result.context).toBe('');
    expect(result.warnings).toEqual([]);
  });

  it('returns empty when tracking is disabled', async () => {
    mockConfig.estimationTracking = false;

    const result = await getEstimationCalibrationContext('proj-1');
    expect(result.context).toBe('');
  });

  it('includes warnings for underestimated categories', async () => {
    // Simulate 4 standard tasks with high review cycles
    const metrics = {};
    for (let i = 0; i < 4; i++) {
      metrics[`t${i}`] = makeMetric({
        taskId: `t${i}`,
        estimatedDevPoints: 3,
        totalDurationSeconds: 1200,
        reviewCycles: 5,
        filesCount: 4,
      });
    }
    mockDbRef.once.mockResolvedValue({ val: () => metrics });

    const result = await getEstimationCalibrationContext('proj-1');

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].range).toBe('standard');
    expect(result.context).toContain('WARNINGS');
  });

  it('handles Firebase errors gracefully', async () => {
    mockDbRef.once.mockRejectedValue(new Error('Firebase down'));

    const result = await getEstimationCalibrationContext('proj-1');
    expect(result.context).toBe('');
    expect(result.warnings).toEqual([]);
  });
});
