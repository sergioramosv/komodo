import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../agents/rate-limit-detector.js', () => ({
  detectRateLimit: vi.fn((msg, cli) => ({
    detected: /rate.limit|429|too many requests/i.test(msg),
  })),
  parseRetryAfter: vi.fn((msg) => {
    const match = msg.match(/retry.after:\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }),
}));
vi.mock('../../agents/fallback-manager.js', () => ({
  fallbackManager: {
    getAvailableFallbackCli: vi.fn(() => null),
    markRateLimited: vi.fn(),
    markRecovered: vi.fn(),
  },
}));

import { rateLimitStrategy } from './rate-limit.js';
import { fallbackManager } from '../../agents/fallback-manager.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rateLimitStrategy', () => {
  describe('detect()', () => {
    it('returns true for rate limit errors', () => {
      expect(rateLimitStrategy.detect({ errorMessage: 'Error 429: rate limit exceeded' })).toBe(true);
      expect(rateLimitStrategy.detect({ errorMessage: 'Too many requests' })).toBe(true);
    });

    it('returns false for non-rate-limit errors', () => {
      expect(rateLimitStrategy.detect({ errorMessage: 'Connection refused' })).toBe(false);
    });

    it('returns false for empty/missing errorMessage', () => {
      expect(rateLimitStrategy.detect({ errorMessage: '' })).toBe(false);
      expect(rateLimitStrategy.detect({})).toBe(false);
    });
  });

  describe('heal()', () => {
    it('switches to fallback CLI when available', async () => {
      fallbackManager.getAvailableFallbackCli.mockReturnValueOnce('codex');
      const result = await rateLimitStrategy.heal({
        errorMessage: 'rate limit exceeded',
        cli: 'claude',
        agentName: 'CODER',
      });
      expect(result.healed).toBe(true);
      expect(result.action).toBe('fallback-cli');
      expect(result.fallbackCli).toBe('codex');
      expect(fallbackManager.markRateLimited).toHaveBeenCalledWith('claude');
    });

    it('waits retryAfterSeconds when no fallback is available', async () => {
      fallbackManager.getAvailableFallbackCli.mockReturnValueOnce(null);
      vi.useFakeTimers();

      const healPromise = rateLimitStrategy.heal({
        errorMessage: 'rate limit exceeded. Retry-After: 2',
        cli: 'claude',
      });

      await vi.advanceTimersByTimeAsync(2000);
      const result = await healPromise;

      expect(result.healed).toBe(true);
      expect(result.action).toBe('waited');
      expect(result.waitMs).toBe(2000);
      expect(fallbackManager.markRecovered).toHaveBeenCalledWith('claude');
      vi.useRealTimers();
    });

    it('returns healed:false when no fallback and no retryAfter', async () => {
      fallbackManager.getAvailableFallbackCli.mockReturnValueOnce(null);
      const result = await rateLimitStrategy.heal({
        errorMessage: 'rate limit exceeded',
        cli: 'claude',
      });
      expect(result.healed).toBe(false);
      expect(result.action).toBe('no-fallback-available');
    });
  });
});
