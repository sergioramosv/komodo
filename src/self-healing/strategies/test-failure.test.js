import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../flaky-test-registry.js', () => ({
  flakyTestRegistry: {
    register: vi.fn(),
    isKnownFlaky: vi.fn(() => false),
    recordRetryResult: vi.fn(),
  },
}));

const { flakyTestRegistry } = await import('../flaky-test-registry.js');
import { testFailureStrategy } from './test-failure.js';

const FAILING_OUTPUT = `
FAIL src/auth.test.js
  ● login › should return token

    AssertionError: expected null to equal "abc123"

    ✕ login › should return token (120ms)

  Tests failed: 1
`;

const FLAKY_OUTPUT = `
FAIL src/integration.test.js
  ● network › fetch data

    Error: ETIMEDOUT: connection timeout

  Tests failed: 1
`;

const NORMAL_OUTPUT = `
✓ all tests passed
`;

describe('testFailureStrategy.detect', () => {
  it('detects test failures', () => {
    expect(testFailureStrategy.detect({ errorMessage: FAILING_OUTPUT })).toBe(true);
  });

  it('detects flaky network errors', () => {
    expect(testFailureStrategy.detect({ errorMessage: FLAKY_OUTPUT })).toBe(true);
  });

  it('does not detect on normal output', () => {
    expect(testFailureStrategy.detect({ errorMessage: NORMAL_OUTPUT })).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(testFailureStrategy.detect({ errorMessage: '' })).toBe(false);
    expect(testFailureStrategy.detect({ errorMessage: null })).toBe(false);
  });
});

describe('testFailureStrategy.diagnose', () => {
  beforeEach(() => vi.clearAllMocks());

  it('classifies flaky when ETIMEDOUT present', () => {
    const result = testFailureStrategy.diagnose({ errorMessage: FLAKY_OUTPUT });
    expect(result.failureType).toBe('flaky');
  });

  it('classifies new-test-failure for assertion errors', () => {
    flakyTestRegistry.isKnownFlaky.mockReturnValue(false);
    const result = testFailureStrategy.diagnose({ errorMessage: FAILING_OUTPUT });
    expect(result.failureType).toBe('new-test-failure');
  });

  it('classifies flaky when test is known flaky', () => {
    flakyTestRegistry.isKnownFlaky.mockReturnValue(true);
    const result = testFailureStrategy.diagnose({ errorMessage: FAILING_OUTPUT });
    expect(result.failureType).toBe('flaky');
  });

  it('returns testNames array', () => {
    const result = testFailureStrategy.diagnose({ errorMessage: FAILING_OUTPUT });
    expect(Array.isArray(result.testNames)).toBe(true);
  });
});

describe('testFailureStrategy.heal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries without LLM for flaky test that passes on retry', async () => {
    const runTests = vi.fn().mockResolvedValue({ passed: true, output: '' });
    const result = await testFailureStrategy.heal({
      errorMessage: FLAKY_OUTPUT,
      runTests,
    });
    expect(result.healed).toBe(true);
    expect(result.action).toBe('flaky-retry-passed');
    expect(runTests).toHaveBeenCalledOnce();
    expect(flakyTestRegistry.register).toHaveBeenCalled();
  });

  it('returns healed=false when flaky retry also fails', async () => {
    const runTests = vi.fn().mockResolvedValue({ passed: false, output: 'still failing' });
    const result = await testFailureStrategy.heal({
      errorMessage: FLAKY_OUTPUT,
      runTests,
    });
    expect(result.healed).toBe(false);
    expect(result.action).toBe('flaky-retry-failed');
  });

  it('calls fixCode for new-test-failure', async () => {
    flakyTestRegistry.isKnownFlaky.mockReturnValue(false);
    const fixCode = vi.fn().mockResolvedValue({ success: true });
    const result = await testFailureStrategy.heal({
      errorMessage: FAILING_OUTPUT,
      fixCode,
    });
    expect(result.healed).toBe(true);
    expect(fixCode).toHaveBeenCalledOnce();
  });

  it('returns healed=false when no fix available', async () => {
    flakyTestRegistry.isKnownFlaky.mockReturnValue(false);
    const result = await testFailureStrategy.heal({ errorMessage: FAILING_OUTPUT });
    expect(result.healed).toBe(false);
    expect(result.action).toBe('no-fix-available');
  });
});
