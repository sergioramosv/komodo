import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectRateLimit, checkAndEmitRateLimit } from './rate-limit-detector.js';

// Mock event-bus before importing the module under test
vi.mock('../events/event-bus.js', () => {
  const emitEvent = vi.fn(() => ({}));
  return {
    eventBus: { emitEvent },
    EVENT_TYPES: { RATE_LIMIT_DETECTED: 'agent:rate-limit' },
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Import mocks after vi.mock declarations
const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { logger } = await import('../utils/logger.js');

// ── Real-world CLI rate limit outputs ─────────────────────────

const CLAUDE_RATE_LIMIT_STDERR = `Error: 429 Too many requests. You have been rate limited. Please slow down.`;

const CLAUDE_OVERLOADED_STDERR = `Error: Overloaded. The API is temporarily overloaded. Please try again later.`;

const CODEX_RATE_LIMIT_STDERR = `Error: 429 rate_limit_exceeded: You've exceeded your rate limit. Current usage: 90000 tokens per min. Please retry after 22s.`;

const CODEX_TOO_MANY_REQUESTS = `{"error":{"message":"Too many requests","type":"rate_limit_error","code":"429"}}`;

const GEMINI_RESOURCE_EXHAUSTED = `Error: RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Generate content requests per minute'`;

const GEMINI_429_ERROR = `Error: 429 Too Many Requests - quota exceeded for the project`;

// ── Normal (non-rate-limit) outputs ───────────────────────────

const NORMAL_STDERR = `Warning: deprecated API version, please update`;

const NORMAL_ERROR = `Error: ENOENT: no such file or directory, open '/foo/bar.js'`;

const NORMAL_STDOUT_WITH_429_IN_CODE = `Found 429 items in the database. Processing...`;

// ══════════════════════════════════════════════════════════════

describe('detectRateLimit', () => {
  describe('Claude CLI', () => {
    it('detects HTTP 429 rate limit error', () => {
      const result = detectRateLimit(CLAUDE_RATE_LIMIT_STDERR, 'claude');
      expect(result.detected).toBe(true);
      expect(result.matchedPattern).toBeTruthy();
    });

    it('detects overloaded/capacity error', () => {
      const result = detectRateLimit(CLAUDE_OVERLOADED_STDERR, 'claude');
      expect(result.detected).toBe(true);
    });

    it('detects "usage limit" message', () => {
      const result = detectRateLimit('Your usage limit has been reached', 'claude');
      expect(result.detected).toBe(true);
    });

    it('detects "quota exceeded" message', () => {
      const result = detectRateLimit('Error: quota exceeded for your organization', 'claude');
      expect(result.detected).toBe(true);
    });
  });

  describe('Codex CLI', () => {
    it('detects rate_limit_exceeded error', () => {
      const result = detectRateLimit(CODEX_RATE_LIMIT_STDERR, 'codex');
      expect(result.detected).toBe(true);
    });

    it('detects "Too many requests" JSON error', () => {
      const result = detectRateLimit(CODEX_TOO_MANY_REQUESTS, 'codex');
      expect(result.detected).toBe(true);
    });

    it('detects "tokens per min" throttle message', () => {
      const result = detectRateLimit('Rate limit: 10000 tokens per min exceeded', 'codex');
      expect(result.detected).toBe(true);
    });

    it('detects "requests per min" throttle message', () => {
      const result = detectRateLimit('Limit: 60 requests per min', 'codex');
      expect(result.detected).toBe(true);
    });
  });

  describe('Gemini CLI', () => {
    it('detects RESOURCE_EXHAUSTED error', () => {
      const result = detectRateLimit(GEMINI_RESOURCE_EXHAUSTED, 'gemini');
      expect(result.detected).toBe(true);
    });

    it('detects 429 Too Many Requests', () => {
      const result = detectRateLimit(GEMINI_429_ERROR, 'gemini');
      expect(result.detected).toBe(true);
    });

    it('detects "quota exceeded" variant', () => {
      const result = detectRateLimit('Error: quota has been exceeded for this project', 'gemini');
      expect(result.detected).toBe(true);
    });
  });

  describe('no false positives', () => {
    it('does not detect rate limit in normal stderr', () => {
      const result = detectRateLimit(NORMAL_STDERR, 'claude');
      expect(result.detected).toBe(false);
      expect(result.matchedPattern).toBeNull();
    });

    it('does not detect rate limit in ENOENT errors', () => {
      const result = detectRateLimit(NORMAL_ERROR, 'codex');
      expect(result.detected).toBe(false);
    });

    it('returns false for empty text', () => {
      expect(detectRateLimit('', 'claude').detected).toBe(false);
      expect(detectRateLimit(null, 'claude').detected).toBe(false);
      expect(detectRateLimit(undefined, 'claude').detected).toBe(false);
    });

    it('returns false for unknown CLI', () => {
      const result = detectRateLimit('rate limit exceeded', 'unknown-cli');
      expect(result.detected).toBe(false);
    });

    it('returns false when cli is null/undefined', () => {
      expect(detectRateLimit('rate limit', null).detected).toBe(false);
      expect(detectRateLimit('rate limit', undefined).detected).toBe(false);
    });
  });
});

describe('checkAndEmitRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits RATE_LIMIT_DETECTED event when rate limit found', () => {
    const result = checkAndEmitRateLimit(CLAUDE_RATE_LIMIT_STDERR, 'claude', 'CODER');

    expect(result).toBe(true);
    expect(eventBus.emitEvent).toHaveBeenCalledOnce();
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.RATE_LIMIT_DETECTED,
      expect.objectContaining({
        agentName: 'CODER',
        metadata: expect.objectContaining({
          cli: 'claude',
          matchedPattern: expect.any(String),
          timestamp: expect.any(String),
        }),
      }),
    );
  });

  it('logs a warning when rate limit detected', () => {
    checkAndEmitRateLimit(CODEX_RATE_LIMIT_STDERR, 'codex', 'CODER');

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Rate limit detected'),
      'CODER',
    );
  });

  it('does NOT emit event when no rate limit found', () => {
    const result = checkAndEmitRateLimit(NORMAL_STDERR, 'claude', 'PLANNER');

    expect(result).toBe(false);
    expect(eventBus.emitEvent).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is transparent for normal errors (returns false, no side effects)', () => {
    const result = checkAndEmitRateLimit(NORMAL_ERROR, 'gemini', 'REVIEWER');

    expect(result).toBe(false);
    expect(eventBus.emitEvent).not.toHaveBeenCalled();
  });

  it('includes correct metadata for each CLI type', () => {
    checkAndEmitRateLimit(GEMINI_RESOURCE_EXHAUSTED, 'gemini', 'REVIEWER');

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.RATE_LIMIT_DETECTED,
      expect.objectContaining({
        agentName: 'REVIEWER',
        metadata: expect.objectContaining({ cli: 'gemini' }),
      }),
    );
  });
});
