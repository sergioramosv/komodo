import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { githubApiErrorStrategy } from './github-api-error.js';

describe('githubApiErrorStrategy.detect', () => {
  it('detects 502 bad gateway', () => {
    expect(githubApiErrorStrategy.detect({ errorMessage: 'HTTP 502 bad gateway' })).toBe(true);
  });

  it('detects ECONNREFUSED', () => {
    expect(githubApiErrorStrategy.detect({ errorMessage: 'connect ECONNREFUSED 127.0.0.1' })).toBe(true);
  });

  it('detects gh CLI failure', () => {
    expect(githubApiErrorStrategy.detect({ errorMessage: 'gh: failed to create PR' })).toBe(true);
  });

  it('returns false for non-matching errors', () => {
    expect(githubApiErrorStrategy.detect({ errorMessage: 'syntax error in file.js' })).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(githubApiErrorStrategy.detect({ errorMessage: '' })).toBe(false);
    expect(githubApiErrorStrategy.detect({ errorMessage: null })).toBe(false);
  });
});

describe('githubApiErrorStrategy.diagnose', () => {
  it('returns matched pattern source', () => {
    const result = githubApiErrorStrategy.diagnose({ errorMessage: 'ETIMEDOUT' });
    expect(result.matchedPattern).toBe('ETIMEDOUT');
  });

  it('returns null when no pattern matches', () => {
    const result = githubApiErrorStrategy.diagnose({ errorMessage: 'unknown' });
    expect(result.matchedPattern).toBeNull();
  });
});

describe('githubApiErrorStrategy.heal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns healed=true on first successful retry', async () => {
    const action = vi.fn().mockResolvedValue('ok');
    const promise = githubApiErrorStrategy.heal({ errorMessage: '502', action });
    const result = await promise;
    expect(result.healed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.result).toBe('ok');
  });

  it('retries with exponential backoff and succeeds on attempt 2', async () => {
    const action = vi.fn()
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValue('ok');
    const promise = githubApiErrorStrategy.heal({ errorMessage: '502', action });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result.healed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('returns healed=false after exhausting all attempts', async () => {
    const action = vi.fn().mockRejectedValue(new Error('502'));
    const promise = githubApiErrorStrategy.heal({ errorMessage: '502', action });
    await vi.advanceTimersByTimeAsync(100000);
    const result = await promise;
    expect(result.healed).toBe(false);
    expect(result.attempts).toBe(5);
  });

  it('returns healed=false when no action provided', async () => {
    const result = await githubApiErrorStrategy.heal({ errorMessage: '502' });
    expect(result.healed).toBe(false);
    expect(result.attempts).toBe(0);
  });
});
