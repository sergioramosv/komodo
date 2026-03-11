import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    rateLimitTokenWindowMs: 300000, // 5 minutes
    rateLimitTokenBudget: 400000,
  },
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { rateLimitTracker, recordTokenConsumption, getRateLimitHeadroom } from './rate-limit-tracker.js';

beforeEach(() => {
  rateLimitTracker.reset();
  mockConfig.rateLimitTokenWindowMs = 300000;
  mockConfig.rateLimitTokenBudget = 400000;
});

describe('RateLimitTracker', () => {
  describe('recordTokenConsumption', () => {
    it('records tokens and tracks usage', () => {
      recordTokenConsumption(50000);

      const headroom = getRateLimitHeadroom();
      expect(headroom.usedTokens).toBe(50000);
      expect(headroom.availableTokens).toBe(350000);
    });

    it('accumulates multiple recordings', () => {
      recordTokenConsumption(50000);
      recordTokenConsumption(30000);
      recordTokenConsumption(20000);

      const headroom = getRateLimitHeadroom();
      expect(headroom.usedTokens).toBe(100000);
      expect(headroom.availableTokens).toBe(300000);
    });
  });

  describe('getHeadroom', () => {
    it('returns full budget when no tokens consumed', () => {
      const headroom = getRateLimitHeadroom();

      expect(headroom.availableTokens).toBe(400000);
      expect(headroom.usedTokens).toBe(0);
    });

    it('returns 0 available when budget exceeded', () => {
      recordTokenConsumption(400000);
      recordTokenConsumption(50000);

      const headroom = getRateLimitHeadroom();
      expect(headroom.availableTokens).toBe(0);
      expect(headroom.usedTokens).toBe(450000);
    });

    it('provides a resetTime in the future', () => {
      recordTokenConsumption(10000);
      const now = Date.now();

      const headroom = getRateLimitHeadroom();
      expect(headroom.resetTime).toBeGreaterThanOrEqual(now);
      expect(headroom.resetTime).toBeLessThanOrEqual(now + 300000 + 100); // window + small tolerance
    });

    it('provides resetTime even with empty window', () => {
      const now = Date.now();
      const headroom = getRateLimitHeadroom();

      expect(headroom.resetTime).toBeGreaterThanOrEqual(now);
    });
  });

  describe('sliding window eviction', () => {
    it('evicts expired entries', () => {
      // Manually push an old entry
      const oldTimestamp = Date.now() - 400000; // 400s ago (beyond 300s window)
      rateLimitTracker._window.push({ timestamp: oldTimestamp, tokens: 100000 });

      const headroom = getRateLimitHeadroom();
      // Old entry should be evicted
      expect(headroom.usedTokens).toBe(0);
      expect(headroom.availableTokens).toBe(400000);
    });

    it('keeps entries within the window', () => {
      // Push a recent entry
      const recentTimestamp = Date.now() - 100000; // 100s ago (within 300s window)
      rateLimitTracker._window.push({ timestamp: recentTimestamp, tokens: 75000 });

      const headroom = getRateLimitHeadroom();
      expect(headroom.usedTokens).toBe(75000);
      expect(headroom.availableTokens).toBe(325000);
    });
  });

  describe('reset', () => {
    it('clears all recorded tokens', () => {
      recordTokenConsumption(200000);
      expect(getRateLimitHeadroom().usedTokens).toBe(200000);

      rateLimitTracker.reset();
      expect(getRateLimitHeadroom().usedTokens).toBe(0);
      expect(getRateLimitHeadroom().availableTokens).toBe(400000);
    });
  });

  describe('respects config values', () => {
    it('uses rateLimitTokenBudget from config', () => {
      mockConfig.rateLimitTokenBudget = 100000;

      recordTokenConsumption(60000);
      const headroom = getRateLimitHeadroom();

      expect(headroom.availableTokens).toBe(40000);
    });
  });
});
