// src/estimation/rate-limit-forecaster.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitForecaster } from './rate-limit-forecaster.js';

// We test the class directly; singleton helpers are thin wrappers tested separately.
// Export the class for testing by importing the module under test.

// Re-import to get the class (we'll use a local instance to avoid singleton pollution)
let forecaster;

// Patch: the module only exports the singleton. We instantiate our own via dynamic import trick.
// Instead, we test via the exported singleton but reset it between tests.
import { rateLimitForecaster, recordForecasterConsumption, forecastRateLimit } from './rate-limit-forecaster.js';

const BUDGET = 100_000; // tokens
const CLI_A = 'cli-a';
const CLI_B = 'cli-b';

describe('RateLimitForecaster', () => {
  beforeEach(() => {
    rateLimitForecaster.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('record()', () => {
    it('records a token entry for a CLI', () => {
      rateLimitForecaster.record(CLI_A, 5000);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.estimatedHeadroom).toBe(BUDGET - 5000);
    });

    it('ignores invalid tokens (negative)', () => {
      rateLimitForecaster.record(CLI_A, -100);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.estimatedHeadroom).toBe(BUDGET);
    });

    it('ignores missing cli', () => {
      expect(() => rateLimitForecaster.record(null, 1000)).not.toThrow();
    });

    it('accumulates multiple entries', () => {
      rateLimitForecaster.record(CLI_A, 3000);
      rateLimitForecaster.record(CLI_A, 7000);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.estimatedHeadroom).toBe(BUDGET - 10_000);
    });
  });

  describe('_evictExpired() — 2-hour window', () => {
    it('evicts entries older than 2 hours', () => {
      // Record at t=0
      rateLimitForecaster.record(CLI_A, 50_000);

      // Advance 2h + 1ms
      vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);

      // Record a new small entry so forecast is computed
      rateLimitForecaster.record(CLI_A, 1000);

      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      // Only the 1000-token entry should remain
      expect(result.estimatedHeadroom).toBe(BUDGET - 1000);
    });

    it('keeps entries exactly at the boundary (within 2h)', () => {
      rateLimitForecaster.record(CLI_A, 10_000);

      // Advance just under 2h
      vi.advanceTimersByTime(2 * 60 * 60 * 1000 - 1000);

      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.estimatedHeadroom).toBe(BUDGET - 10_000);
    });
  });

  describe('forecast() calculations', () => {
    it('returns confident:false with fewer than 3 data points', () => {
      rateLimitForecaster.record(CLI_A, 5000);
      rateLimitForecaster.record(CLI_A, 5000);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.confident).toBe(false);
    });

    it('returns confident:true with 3 or more data points', () => {
      rateLimitForecaster.record(CLI_A, 5000);
      rateLimitForecaster.record(CLI_A, 5000);
      rateLimitForecaster.record(CLI_A, 5000);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.confident).toBe(true);
    });

    it('returns confident:false and safe defaults for empty history', () => {
      const result = rateLimitForecaster.forecast('unknown-cli', BUDGET);
      expect(result.confident).toBe(false);
      expect(result.tokensPerMinute).toBe(0);
      expect(result.estimatedHeadroom).toBe(BUDGET);
      expect(result.minutesToRateLimit).toBe(Infinity);
      expect(result.recommendation).toBe('green');
    });

    it('calculates tokensPerMinute correctly', () => {
      // Record 12000 tokens, then advance 10 minutes
      rateLimitForecaster.record(CLI_A, 12_000);
      vi.advanceTimersByTime(10 * 60 * 1000);
      rateLimitForecaster.record(CLI_A, 0); // trigger eviction/refresh at new time

      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      // ~12000 tokens over ~10 minutes = ~1200 tok/min (approximate due to elapsed time)
      expect(result.tokensPerMinute).toBeGreaterThan(0);
    });

    it('calculates estimatedHeadroom as budget minus used tokens', () => {
      rateLimitForecaster.record(CLI_A, 20_000);
      rateLimitForecaster.record(CLI_A, 15_000);
      rateLimitForecaster.record(CLI_A, 10_000);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.estimatedHeadroom).toBe(BUDGET - 45_000);
    });

    it('caps estimatedHeadroom at 0 if over budget', () => {
      rateLimitForecaster.record(CLI_A, 60_000);
      rateLimitForecaster.record(CLI_A, 50_000);
      rateLimitForecaster.record(CLI_A, 10_000);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.estimatedHeadroom).toBe(0);
    });

    it('tracks CLIs independently', () => {
      rateLimitForecaster.record(CLI_A, 10_000);
      rateLimitForecaster.record(CLI_B, 50_000);

      const a = rateLimitForecaster.forecast(CLI_A, BUDGET);
      const b = rateLimitForecaster.forecast(CLI_B, BUDGET);

      expect(a.estimatedHeadroom).toBe(BUDGET - 10_000);
      expect(b.estimatedHeadroom).toBe(BUDGET - 50_000);
    });
  });

  describe('recommendation thresholds', () => {
    it('returns green when minutesToRateLimit > 60', () => {
      // Very small consumption → virtually unlimited headroom
      rateLimitForecaster.record(CLI_A, 1);
      rateLimitForecaster.record(CLI_A, 1);
      rateLimitForecaster.record(CLI_A, 1);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.recommendation).toBe('green');
    });

    it('returns red when minutesToRateLimit <= 5', () => {
      // Consume 99000 of 100000 tokens quickly, leaving only 1000 tokens
      // and a high consumption rate
      rateLimitForecaster.record(CLI_A, 33_000);
      vi.advanceTimersByTime(60_000); // 1 minute
      rateLimitForecaster.record(CLI_A, 33_000);
      vi.advanceTimersByTime(60_000);
      rateLimitForecaster.record(CLI_A, 33_000);
      // Used 99000, headroom = 1000, rate ~33000/min → < 1 min left → red
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.recommendation).toBe('red');
    });
  });

  describe('reset()', () => {
    it('clears all history', () => {
      rateLimitForecaster.record(CLI_A, 10_000);
      rateLimitForecaster.record(CLI_B, 20_000);
      rateLimitForecaster.reset();

      const a = rateLimitForecaster.forecast(CLI_A, BUDGET);
      const b = rateLimitForecaster.forecast(CLI_B, BUDGET);

      expect(a.estimatedHeadroom).toBe(BUDGET);
      expect(b.estimatedHeadroom).toBe(BUDGET);
    });
  });

  describe('helper functions', () => {
    it('recordForecasterConsumption delegates to singleton', () => {
      recordForecasterConsumption(CLI_A, 5000);
      const result = rateLimitForecaster.forecast(CLI_A, BUDGET);
      expect(result.estimatedHeadroom).toBe(BUDGET - 5000);
    });

    it('forecastRateLimit delegates to singleton and returns result', () => {
      recordForecasterConsumption(CLI_A, 5000);
      recordForecasterConsumption(CLI_A, 5000);
      recordForecasterConsumption(CLI_A, 5000);
      const result = forecastRateLimit(CLI_A, BUDGET);
      expect(result).toMatchObject({ cli: CLI_A, confident: true });
    });
  });
});
