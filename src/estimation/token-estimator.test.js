// src/estimation/token-estimator.test.js

import { describe, it, expect } from 'vitest';
import { estimateTaskTokens, estimateTaskTokensCalibrated } from './token-estimator.js';

const TASK_SPEC = { devPoints: 2 };

describe('estimateTaskTokens', () => {
  it('returns trivial base tokens for trivial level', () => {
    const result = estimateTaskTokens(TASK_SPEC, 'trivial');
    expect(result.total).toBe(8000);
  });

  it('returns standard base tokens for standard level', () => {
    const result = estimateTaskTokens(TASK_SPEC, 'standard');
    expect(result.total).toBe(25000);
  });

  it('returns complex base tokens for complex level', () => {
    const result = estimateTaskTokens(TASK_SPEC, 'complex');
    expect(result.total).toBe(60000);
  });

  it('falls back to devPoints-based estimation when complexityLevel is absent', () => {
    const result = estimateTaskTokens({ devPoints: 1 });
    expect(result.total).toBeGreaterThanOrEqual(8000);
  });

  it('breakdown phases sum to total', () => {
    const result = estimateTaskTokens(TASK_SPEC, 'standard');
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(result.total);
  });

  it('breakdown contains all expected phases', () => {
    const result = estimateTaskTokens(TASK_SPEC, 'trivial');
    expect(result.breakdown).toHaveProperty('architect');
    expect(result.breakdown).toHaveProperty('coder');
    expect(result.breakdown).toHaveProperty('security');
    expect(result.breakdown).toHaveProperty('reviewer');
    expect(result.breakdown).toHaveProperty('overhead');
  });
});

describe('estimateTaskTokensCalibrated', () => {
  it('returns base estimate when no multipliers provided', () => {
    const base = estimateTaskTokens(TASK_SPEC, 'standard');
    const calibrated = estimateTaskTokensCalibrated(TASK_SPEC, 'standard', null);
    expect(calibrated.total).toBe(base.total);
    expect(calibrated.multiplierApplied).toBe(1.0);
  });

  it('applies 1.5x multiplier for standard complexity', () => {
    const base = estimateTaskTokens(TASK_SPEC, 'standard');
    const multipliers = { trivial: 1.0, standard: 1.5, complex: 1.0 };
    const calibrated = estimateTaskTokensCalibrated(TASK_SPEC, 'standard', multipliers);
    expect(calibrated.total).toBe(Math.round(base.total * 1.5));
    expect(calibrated.multiplierApplied).toBe(1.5);
  });

  it('applies 0.8x multiplier for trivial complexity', () => {
    const base = estimateTaskTokens(TASK_SPEC, 'trivial');
    const multipliers = { trivial: 0.8, standard: 1.0, complex: 1.0 };
    const calibrated = estimateTaskTokensCalibrated(TASK_SPEC, 'trivial', multipliers);
    expect(calibrated.total).toBe(Math.round(base.total * 0.8));
    expect(calibrated.multiplierApplied).toBe(0.8);
  });

  it('applies 2.0x multiplier for complex tasks', () => {
    const base = estimateTaskTokens(TASK_SPEC, 'complex');
    const multipliers = { trivial: 1.0, standard: 1.0, complex: 2.0 };
    const calibrated = estimateTaskTokensCalibrated(TASK_SPEC, 'complex', multipliers);
    expect(calibrated.total).toBe(Math.round(base.total * 2.0));
    expect(calibrated.multiplierApplied).toBe(2.0);
  });

  it('falls back to 1.0 multiplier when complexityLevel is null', () => {
    const base = estimateTaskTokens(TASK_SPEC);
    const multipliers = { trivial: 2.0, standard: 2.0, complex: 2.0 };
    const calibrated = estimateTaskTokensCalibrated(TASK_SPEC, null, multipliers);
    expect(calibrated.multiplierApplied).toBe(1.0);
    expect(calibrated.total).toBe(base.total);
  });

  it('falls back to 1.0 multiplier when complexityLevel is invalid', () => {
    const multipliers = { trivial: 1.5, standard: 1.5, complex: 1.5 };
    const calibrated = estimateTaskTokensCalibrated(TASK_SPEC, 'unknown', multipliers);
    expect(calibrated.multiplierApplied).toBe(1.0);
  });

  it('returns 1.0 multiplierApplied when multiplier for level is 1.0', () => {
    const multipliers = { trivial: 1.0, standard: 1.0, complex: 1.0 };
    const calibrated = estimateTaskTokensCalibrated(TASK_SPEC, 'standard', multipliers);
    expect(calibrated.multiplierApplied).toBe(1.0);
  });

  it('calibrated breakdown phases sum to calibrated total', () => {
    const multipliers = { trivial: 1.0, standard: 1.3, complex: 1.0 };
    const calibrated = estimateTaskTokensCalibrated(TASK_SPEC, 'standard', multipliers);
    const sum = Object.values(calibrated.breakdown).reduce((a, b) => a + b, 0);
    // Allow off-by-one due to per-phase rounding
    expect(Math.abs(sum - calibrated.total)).toBeLessThanOrEqual(5);
  });
});
