import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../events/event-bus.js', () => {
  const emitEvent = vi.fn(() => ({}));
  return {
    eventBus: { emitEvent },
    EVENT_TYPES: {
      AGENT_FALLBACK: 'agent:fallback',
      RATE_LIMIT_DETECTED: 'agent:rate-limit',
    },
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config.js', () => ({
  config: {
    rateLimitFallback: true,
    fallbackCliOrder: ['claude', 'codex', 'gemini'],
    rateLimitCooldownMinutes: 15,
  },
  cliExists: vi.fn(() => true),
}));

const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { config, cliExists } = await import('../config.js');
const { fallbackManager } = await import('./fallback-manager.js');

describe('FallbackManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fallbackManager.clear();
    config.rateLimitFallback = true;
    config.fallbackCliOrder = ['claude', 'codex', 'gemini'];
    config.rateLimitCooldownMinutes = 15;
    cliExists.mockReturnValue(true);
  });

  describe('isEnabled', () => {
    it('returns true when RATE_LIMIT_FALLBACK is true', () => {
      config.rateLimitFallback = true;
      expect(fallbackManager.isEnabled()).toBe(true);
    });

    it('returns false when RATE_LIMIT_FALLBACK is false', () => {
      config.rateLimitFallback = false;
      expect(fallbackManager.isEnabled()).toBe(false);
    });
  });

  describe('markRateLimited / isRateLimited', () => {
    it('marks a CLI as rate-limited', () => {
      fallbackManager.markRateLimited('claude');
      expect(fallbackManager.isRateLimited('claude')).toBe(true);
    });

    it('returns false for a CLI not marked', () => {
      expect(fallbackManager.isRateLimited('codex')).toBe(false);
    });

    it('clears rate limit after cooldown expires', () => {
      fallbackManager.markRateLimited('claude');

      // Simulate cooldown expiry by manipulating the internal map
      fallbackManager._rateLimitedClis.set('claude', Date.now() - (16 * 60 * 1000));

      expect(fallbackManager.isRateLimited('claude')).toBe(false);
    });

    it('keeps rate limit during cooldown period', () => {
      fallbackManager.markRateLimited('claude');

      // Only 5 minutes ago — still within 15min cooldown
      fallbackManager._rateLimitedClis.set('claude', Date.now() - (5 * 60 * 1000));

      expect(fallbackManager.isRateLimited('claude')).toBe(true);
    });
  });

  describe('getRateLimitedClis', () => {
    it('returns all rate-limited CLIs', () => {
      fallbackManager.markRateLimited('claude');
      fallbackManager.markRateLimited('codex');

      const limited = fallbackManager.getRateLimitedClis();
      expect(limited).toContain('claude');
      expect(limited).toContain('codex');
    });

    it('cleans up expired entries', () => {
      fallbackManager.markRateLimited('claude');
      fallbackManager._rateLimitedClis.set('claude', Date.now() - (16 * 60 * 1000));

      const limited = fallbackManager.getRateLimitedClis();
      expect(limited).not.toContain('claude');
    });
  });

  describe('getAvailableFallbackCli', () => {
    it('returns next available CLI from fallback order', () => {
      const result = fallbackManager.getAvailableFallbackCli('claude');
      expect(result).toBe('codex');
    });

    it('skips rate-limited CLIs', () => {
      fallbackManager.markRateLimited('codex');
      const result = fallbackManager.getAvailableFallbackCli('claude');
      expect(result).toBe('gemini');
    });

    it('returns null when all CLIs are rate-limited', () => {
      fallbackManager.markRateLimited('codex');
      fallbackManager.markRateLimited('gemini');
      const result = fallbackManager.getAvailableFallbackCli('claude');
      expect(result).toBeNull();
    });

    it('returns null when fallback is disabled', () => {
      config.rateLimitFallback = false;
      const result = fallbackManager.getAvailableFallbackCli('claude');
      expect(result).toBeNull();
    });

    it('returns null when fallback order is empty', () => {
      config.fallbackCliOrder = [];
      const result = fallbackManager.getAvailableFallbackCli('claude');
      expect(result).toBeNull();
    });

    it('skips CLIs not installed on system', () => {
      cliExists.mockImplementation((cli) => cli !== 'codex');
      const result = fallbackManager.getAvailableFallbackCli('claude');
      expect(result).toBe('gemini');
    });
  });

  describe('resolveEffectiveCli', () => {
    it('returns original CLI when not rate-limited', () => {
      const { cli, isFallback } = fallbackManager.resolveEffectiveCli('claude', 'CODER');
      expect(cli).toBe('claude');
      expect(isFallback).toBe(false);
    });

    it('returns fallback CLI when original is rate-limited', () => {
      fallbackManager.markRateLimited('claude');
      const { cli, isFallback } = fallbackManager.resolveEffectiveCli('claude', 'CODER');
      expect(cli).toBe('codex');
      expect(isFallback).toBe(true);
    });

    it('emits AGENT_FALLBACK event when using fallback', () => {
      fallbackManager.markRateLimited('claude');
      fallbackManager.resolveEffectiveCli('claude', 'CODER');

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.AGENT_FALLBACK,
        expect.objectContaining({
          agentName: 'CODER',
          metadata: {
            originalCli: 'claude',
            fallbackCli: 'codex',
            agentRole: 'CODER',
          },
        }),
      );
    });

    it('returns original when fallback disabled', () => {
      config.rateLimitFallback = false;
      fallbackManager.markRateLimited('claude');
      const { cli, isFallback } = fallbackManager.resolveEffectiveCli('claude', 'CODER');
      expect(cli).toBe('claude');
      expect(isFallback).toBe(false);
    });

    it('returns original when no fallback available', () => {
      fallbackManager.markRateLimited('claude');
      fallbackManager.markRateLimited('codex');
      fallbackManager.markRateLimited('gemini');
      const { cli, isFallback } = fallbackManager.resolveEffectiveCli('claude', 'CODER');
      expect(cli).toBe('claude');
      expect(isFallback).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all rate limit records', () => {
      fallbackManager.markRateLimited('claude');
      fallbackManager.markRateLimited('codex');
      fallbackManager.clear();

      expect(fallbackManager.isRateLimited('claude')).toBe(false);
      expect(fallbackManager.isRateLimited('codex')).toBe(false);
      expect(fallbackManager.getRateLimitedClis()).toHaveLength(0);
    });
  });
});
