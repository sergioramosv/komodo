import { describe, it, expect } from 'vitest';
import {
  checkTokenSpike,
  checkReviewRegression,
  checkModelDegradation,
} from './anomaly-detector.js';

// ---------------------------------------------------------------------------
// checkTokenSpike
// ---------------------------------------------------------------------------

describe('checkTokenSpike', () => {
  it('returns null when baseline has fewer than 3 data points', () => {
    expect(checkTokenSpike('task1', 10000, [])).toBeNull();
    expect(checkTokenSpike('task1', 10000, [5000])).toBeNull();
    expect(checkTokenSpike('task1', 10000, [5000, 6000])).toBeNull();
  });

  it('returns null when tokens are below 2x average', () => {
    const baseline = [4000, 5000, 6000]; // avg = 5000
    // 9999 < 2 * 5000 = 10000
    expect(checkTokenSpike('task1', 9999, baseline)).toBeNull();
  });

  it('returns alert when tokens are exactly 2x average (boundary: ratio >= 2 triggers alert)', () => {
    const baseline = [5000, 5000, 5000]; // avg = 5000, threshold = 10000
    // 10000 / 5000 = 2.0 — should trigger alert (ratio >= 2)
    const result = checkTokenSpike('task1', 10000, baseline);
    expect(result).not.toBeNull();
    expect(result.rule).toBe('token-spike');
  });

  it('returns alert when tokens exceed 2x average', () => {
    const baseline = [3000, 4000, 5000]; // avg = 4000
    const result = checkTokenSpike('task-x', 12000, baseline);
    expect(result).not.toBeNull();
    expect(result.rule).toBe('token-spike');
    expect(result.data.taskId).toBe('task-x');
    expect(result.data.totalTokensUsed).toBe(12000);
    expect(result.data.expectedAvg).toBe(4000);
    expect(result.data.ratio).toBe(3);
    expect(result.suggestion).toBeTruthy();
  });

  it('returns null when baseline average is zero', () => {
    expect(checkTokenSpike('task1', 1000, [0, 0, 0])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkReviewRegression
// ---------------------------------------------------------------------------

describe('checkReviewRegression', () => {
  it('returns null when fewer than 5 scores', () => {
    expect(checkReviewRegression([])).toBeNull();
    expect(checkReviewRegression([5, 6, 4])).toBeNull();
    expect(checkReviewRegression([5, 6, 4, 3])).toBeNull();
  });

  it('returns null when at least one score is >= 7', () => {
    // Last 5: [5, 6, 4, 3, 7]
    expect(checkReviewRegression([5, 6, 4, 3, 7])).toBeNull();
    // Last 5: [5, 6, 4, 3, 8] — 8 >= 7
    expect(checkReviewRegression([5, 6, 4, 3, 8])).toBeNull();
  });

  it('returns alert when last 5 scores are all below 7', () => {
    const scores = [5, 6, 4, 3, 6];
    const result = checkReviewRegression(scores);
    expect(result).not.toBeNull();
    expect(result.rule).toBe('review-regression');
    expect(result.data.recentScores).toEqual([5, 6, 4, 3, 6]);
    expect(result.data.avgScore).toBe(4.8);
    expect(result.suggestion).toBeTruthy();
  });

  it('uses only the last 5 scores from a longer array', () => {
    // First 3 are high, last 5 are all low
    const scores = [9, 8, 7, 4, 5, 6, 3, 4];
    const result = checkReviewRegression(scores);
    expect(result).not.toBeNull();
    expect(result.data.recentScores).toEqual([4, 5, 6, 3, 4]);
  });

  it('returns null when last 5 from a longer array include a high score', () => {
    // Last 5: [4, 5, 6, 3, 8]
    const scores = [9, 8, 7, 4, 5, 6, 3, 8];
    expect(checkReviewRegression(scores)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkModelDegradation
// ---------------------------------------------------------------------------

describe('checkModelDegradation', () => {
  it('returns null when fewer than 10 results', () => {
    const results = Array.from({ length: 9 }, () => ({ approved: false }));
    expect(checkModelDegradation('claude-opus-4', results)).toBeNull();
  });

  it('returns null when fail rate is exactly 40% (boundary: must be > 40%)', () => {
    // 4 out of 10 failed = 40%
    const results = [
      ...Array(4).fill({ approved: false }),
      ...Array(6).fill({ approved: true }),
    ];
    expect(checkModelDegradation('claude-opus-4', results)).toBeNull();
  });

  it('returns alert when fail rate exceeds 40%', () => {
    // 5 out of 10 failed = 50%
    const results = [
      ...Array(5).fill({ approved: false }),
      ...Array(5).fill({ approved: true }),
    ];
    const result = checkModelDegradation('claude-opus-4', results);
    expect(result).not.toBeNull();
    expect(result.rule).toBe('model-degradation');
    expect(result.data.model).toBe('claude-opus-4');
    expect(result.data.failCount).toBe(5);
    expect(result.data.taskCount).toBe(10);
    expect(result.data.failRatePercent).toBe(50);
    expect(result.suggestion).toContain('claude-opus-4');
  });

  it('uses only the last 10 results from a longer array', () => {
    // First 5 all pass, last 10 have 5 failures
    const results = [
      ...Array(5).fill({ approved: true }),  // ignored
      ...Array(5).fill({ approved: false }),
      ...Array(5).fill({ approved: true }),
    ];
    // Last 10: 5 false + 5 true → 50% fail rate → alert
    const result = checkModelDegradation('model-x', results);
    expect(result).not.toBeNull();
    expect(result.data.failCount).toBe(5);
  });

  it('returns null when all tasks are approved', () => {
    const results = Array.from({ length: 10 }, () => ({ approved: true }));
    expect(checkModelDegradation('model-x', results)).toBeNull();
  });
});
