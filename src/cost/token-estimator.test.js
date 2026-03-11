import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockConfig, mockGetTaskMetrics, mockEmitEvent } = vi.hoisted(() => {
  return {
    mockConfig: {
      estimationTracking: true,
      tokenLimitEnabled: false,
      tokenWindowSizeK: 100,
      tokenWindowMs: 60_000,
      tokenHeadroomThreshold: 0.8,
    },
    mockGetTaskMetrics: vi.fn().mockResolvedValue([]),
    mockEmitEvent: vi.fn(),
  };
});

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: mockEmitEvent },
  EVENT_TYPES: {
    TOKEN_ESTIMATED: 'token:estimated',
    RATE_LIMIT_PREEMPTIVE_WAIT: 'rate-limit:preemptive-wait',
  },
}));

vi.mock('../estimation/estimation-tracker.js', () => ({
  getTaskMetrics: mockGetTaskMetrics,
  calculateEstimationRatios: vi.fn(() => ({ trivial: null, standard: null, complex: null })),
}));

import {
  estimateTokensFormula,
  estimateTokens,
  checkRateLimitHeadroom,
  waitForRateLimitHeadroom,
  trackTokensUsed,
  getWindowUsed,
  getEfficiencyScore,
} from './token-estimator.js';

import { calculateEstimationRatios } from '../estimation/estimation-tracker.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('estimateTokensFormula()', () => {
  it('returns 8000 for trivial', () => {
    expect(estimateTokensFormula('trivial')).toBe(8_000);
  });

  it('returns 25000 for standard', () => {
    expect(estimateTokensFormula('standard')).toBe(25_000);
  });

  it('returns 60000 for complex', () => {
    expect(estimateTokensFormula('complex')).toBe(60_000);
  });

  it('falls back to standard for unknown complexity', () => {
    expect(estimateTokensFormula('unknown')).toBe(25_000);
  });
});

describe('estimateTokens()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTaskMetrics.mockResolvedValue([]);
    mockConfig.estimationTracking = true;
  });

  it('uses formula fallback when no historical data', async () => {
    const result = await estimateTokens({ complexityLevel: 'standard' });
    expect(result.estimatedTokens).toBe(25_000);
    expect(result.source).toBe('formula');
    expect(result.complexityLevel).toBe('standard');
  });

  it('uses formula fallback for trivial tasks', async () => {
    const result = await estimateTokens({ complexityLevel: 'trivial' });
    expect(result.estimatedTokens).toBe(8_000);
    expect(result.source).toBe('formula');
  });

  it('uses formula fallback for complex tasks', async () => {
    const result = await estimateTokens({ complexityLevel: 'complex' });
    expect(result.estimatedTokens).toBe(60_000);
    expect(result.source).toBe('formula');
  });

  it('defaults to standard when complexityLevel is missing', async () => {
    const result = await estimateTokens({});
    expect(result.estimatedTokens).toBe(25_000);
    expect(result.complexityLevel).toBe('standard');
  });

  it('returns breakdown with 5 agent phases', async () => {
    const result = await estimateTokens({ complexityLevel: 'standard' });
    expect(result.breakdown).toMatchObject({
      architect: expect.any(Number),
      coder: expect.any(Number),
      security: expect.any(Number),
      reviewer: expect.any(Number),
      overhead: expect.any(Number),
    });
  });

  it('breakdown sums to estimatedTokens', async () => {
    const result = await estimateTokens({ complexityLevel: 'complex' });
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(result.estimatedTokens);
  });

  it('emits TOKEN_ESTIMATED event', async () => {
    await estimateTokens({ complexityLevel: 'standard', taskId: 'task-1' });
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'token:estimated',
      expect.objectContaining({
        metadata: expect.objectContaining({
          taskId: 'task-1',
          complexityLevel: 'standard',
          estimatedTokens: 25_000,
          source: 'formula',
        }),
      }),
    );
  });

  it('uses historical calibration when enough metrics are available', async () => {
    // 4 standard tasks with avg 16 files changed (baseline=8 → ratio=2 → 2x estimate, clamped to 2x)
    const fakeMetrics = Array.from({ length: 4 }, (_, i) => ({
      estimatedDevPoints: 3,
      totalDurationSeconds: 600,
      reviewCycles: 1,
      filesCount: 16,
    }));
    mockGetTaskMetrics.mockResolvedValue(fakeMetrics);
    calculateEstimationRatios.mockReturnValue({
      trivial: null,
      standard: { taskCount: 4, avgFilesChanged: 16, avgDuration: 600, avgReviewCycles: 1, avgDevPoints: 3 },
      complex: null,
    });

    const result = await estimateTokens({ complexityLevel: 'standard' }, { projectId: 'proj-1' });
    // ratio = 16/8 = 2.0 → adjustment = 2.0 → 25000 * 2 = 50000
    expect(result.estimatedTokens).toBe(50_000);
    expect(result.source).toBe('historical');
  });

  it('clamps historical adjustment to 0.5x minimum', async () => {
    mockGetTaskMetrics.mockResolvedValue([{}, {}, {}]);
    calculateEstimationRatios.mockReturnValue({
      trivial: null,
      standard: { taskCount: 3, avgFilesChanged: 1, avgDuration: 300, avgReviewCycles: 1, avgDevPoints: 3 },
      complex: null,
    });

    const result = await estimateTokens({ complexityLevel: 'standard' }, { projectId: 'proj-1' });
    // ratio = 1/8 = 0.125 → clamped to 0.5 → 25000 * 0.5 = 12500
    expect(result.estimatedTokens).toBe(12_500);
    expect(result.source).toBe('historical');
  });

  it('falls back to formula if historical data throws', async () => {
    mockGetTaskMetrics.mockRejectedValue(new Error('Firebase down'));
    const result = await estimateTokens({ complexityLevel: 'standard' }, { projectId: 'proj-1' });
    expect(result.source).toBe('formula');
    expect(result.estimatedTokens).toBe(25_000);
  });

  it('skips historical if estimationTracking is disabled', async () => {
    mockConfig.estimationTracking = false;
    const result = await estimateTokens({ complexityLevel: 'standard' }, { projectId: 'proj-1' });
    expect(mockGetTaskMetrics).not.toHaveBeenCalled();
    expect(result.source).toBe('formula');
  });
});

describe('checkRateLimitHeadroom()', () => {
  beforeEach(() => {
    mockConfig.tokenLimitEnabled = false;
  });

  it('returns hasHeadroom=true when tokenLimitEnabled is false', () => {
    const result = checkRateLimitHeadroom(50_000);
    expect(result.hasHeadroom).toBe(true);
    expect(result.available).toBe(Infinity);
  });

  it('returns hasHeadroom=true when enough headroom', () => {
    mockConfig.tokenLimitEnabled = true;
    mockConfig.tokenWindowSizeK = 200; // 200K window
    // window is fresh (no usage) → available = 200K, need 80% of 25K = 20K → OK
    const result = checkRateLimitHeadroom(25_000);
    expect(result.hasHeadroom).toBe(true);
    expect(result.available).toBe(200_000);
  });
});

describe('waitForRateLimitHeadroom()', () => {
  it('returns immediately when headroom is sufficient', async () => {
    mockConfig.tokenLimitEnabled = false;
    await expect(waitForRateLimitHeadroom(25_000)).resolves.toBeUndefined();
    expect(mockEmitEvent).not.toHaveBeenCalledWith('rate-limit:preemptive-wait', expect.anything());
  });

  it('emits RATE_LIMIT_PREEMPTIVE_WAIT when headroom is insufficient', async () => {
    mockConfig.tokenLimitEnabled = true;
    mockConfig.tokenWindowSizeK = 10; // 10K window (tiny)
    mockConfig.tokenWindowMs = 1; // 1ms window so wait is instant
    mockConfig.tokenHeadroomThreshold = 0.8;

    // Simulate full window
    vi.clearAllMocks();

    // Force the window to be "full" by directly calling check with a large estimate
    // 10K window, need 80% of 100K = 80K → not available (only 10K available)
    await waitForRateLimitHeadroom(100_000, { taskId: 'task-x' });

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'rate-limit:preemptive-wait',
      expect.objectContaining({
        metadata: expect.objectContaining({
          estimatedTokens: 100_000,
          taskId: 'task-x',
        }),
      }),
    );
  });
});

describe('trackTokensUsed() and getWindowUsed()', () => {
  it('tracks tokens in window', () => {
    const before = getWindowUsed();
    trackTokensUsed(5_000);
    const after = getWindowUsed();
    expect(after.used).toBe(before.used + 5_000);
  });
});

describe('getEfficiencyScore()', () => {
  it('computes bizPoints / estimated tokens', () => {
    const score = getEfficiencyScore({ complexityLevel: 'trivial', bizPoints: 8 });
    // trivial = 8000 tokens, bizPoints = 8 → efficiency = 8 / 8000 = 0.001
    expect(score).toBeCloseTo(8 / 8_000, 6);
  });

  it('higher bizPoints means higher efficiency', () => {
    const low = getEfficiencyScore({ complexityLevel: 'standard', bizPoints: 1 });
    const high = getEfficiencyScore({ complexityLevel: 'standard', bizPoints: 10 });
    expect(high).toBeGreaterThan(low);
  });

  it('lower complexity means higher efficiency for same bizPoints', () => {
    const trivial = getEfficiencyScore({ complexityLevel: 'trivial', bizPoints: 5 });
    const complex = getEfficiencyScore({ complexityLevel: 'complex', bizPoints: 5 });
    expect(trivial).toBeGreaterThan(complex);
  });

  it('defaults to standard when complexityLevel missing', () => {
    const score = getEfficiencyScore({ bizPoints: 5 });
    expect(score).toBeCloseTo(5 / 25_000, 6);
  });

  it('defaults bizPoints to 1 when missing', () => {
    const score = getEfficiencyScore({ complexityLevel: 'standard' });
    expect(score).toBeCloseTo(1 / 25_000, 6);
  });
});
