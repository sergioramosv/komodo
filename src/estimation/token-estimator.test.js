import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {},
}));

vi.mock('./rate-limit-tracker.js', () => ({
  getRateLimitHeadroom: vi.fn(() => ({ availableTokens: 100000, resetTime: Date.now() + 300000, usedTokens: 0 })),
  recordTokenConsumption: vi.fn(),
}));

import { estimateTaskTokens } from './token-estimator.js';

describe('estimateTaskTokens', () => {
  it('returns base + devPoint tokens for a task', () => {
    const result = estimateTaskTokens({ devPoints: 3 });

    expect(result.total).toBe(5000 + 3 * 15000); // 50000
    expect(result.breakdown.base).toBe(5000);
    expect(result.breakdown.devPoints).toBe(45000);
  });

  it('defaults to 1 devPoint when devPoints is missing', () => {
    const result = estimateTaskTokens({});

    expect(result.total).toBe(5000 + 15000); // 20000
    expect(result.breakdown.devPoints).toBe(15000);
  });

  it('defaults to 1 devPoint when devPoints is 0', () => {
    const result = estimateTaskTokens({ devPoints: 0 });

    expect(result.total).toBe(5000 + 15000);
  });

  it('scales linearly with devPoints', () => {
    const r1 = estimateTaskTokens({ devPoints: 1 });
    const r5 = estimateTaskTokens({ devPoints: 5 });
    const r13 = estimateTaskTokens({ devPoints: 13 });

    expect(r5.total - r1.total).toBe(4 * 15000);
    expect(r13.total - r1.total).toBe(12 * 15000);
  });

  it('handles high devPoints', () => {
    const result = estimateTaskTokens({ devPoints: 21 });

    expect(result.total).toBe(5000 + 21 * 15000);
    expect(result.breakdown.base).toBe(5000);
    expect(result.breakdown.devPoints).toBe(315000);
  });
});
