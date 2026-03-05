import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'path';

vi.mock('../config.js', () => ({
  config: {
    prePrTests: true,
    prePrTestCmd: 'auto',
    rootDir: '/fake/root',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    PRE_PR_TESTS_START: 'tests:pre-pr:start',
    PRE_PR_TESTS_PASSED: 'tests:pre-pr:passed',
    PRE_PR_TESTS_FAILED: 'tests:pre-pr:failed',
  },
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
}));

const { config } = await import('../config.js');
const { eventBus } = await import('../events/event-bus.js');
const { execFileSync } = await import('child_process');
const { existsSync, readFileSync } = await import('fs');
const {
  detectTestCommand,
  resolveTestCommand,
  runTests,
  parseTestSummary,
  executePrePRTests,
} = await import('./pre-pr-tests.js');

describe('pre-pr-tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.prePrTests = true;
    config.prePrTestCmd = 'auto';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── detectTestCommand ──

  describe('detectTestCommand', () => {
    it('detects npm test from package.json', () => {
      existsSync.mockImplementation((p) => p.endsWith('package.json'));
      readFileSync.mockReturnValue(JSON.stringify({ scripts: { test: 'vitest run' } }));

      expect(detectTestCommand('/project')).toBe('npm test');
    });

    it('ignores default npm test placeholder', () => {
      existsSync.mockImplementation((p) => p.endsWith('package.json'));
      readFileSync.mockReturnValue(JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }));

      expect(detectTestCommand('/project')).toBeNull();
    });

    it('detects pytest from pytest.ini', () => {
      existsSync.mockImplementation((p) => p.endsWith('pytest.ini'));

      expect(detectTestCommand('/project')).toBe('pytest');
    });

    it('detects go test from go.mod', () => {
      existsSync.mockImplementation((p) => p.endsWith('go.mod'));

      expect(detectTestCommand('/project')).toBe('go test ./...');
    });

    it('detects cargo test from Cargo.toml', () => {
      existsSync.mockImplementation((p) => p.endsWith('Cargo.toml'));

      expect(detectTestCommand('/project')).toBe('cargo test');
    });

    it('returns null when no test config found', () => {
      existsSync.mockReturnValue(false);

      expect(detectTestCommand('/project')).toBeNull();
    });
  });

  // ── resolveTestCommand ──

  describe('resolveTestCommand', () => {
    it('returns explicit command when configured', () => {
      config.prePrTestCmd = 'npm run test:ci';

      expect(resolveTestCommand('/project')).toBe('npm run test:ci');
    });

    it('auto-detects when set to auto', () => {
      config.prePrTestCmd = 'auto';
      existsSync.mockImplementation((p) => p.endsWith('package.json'));
      readFileSync.mockReturnValue(JSON.stringify({ scripts: { test: 'vitest' } }));

      expect(resolveTestCommand('/project')).toBe('npm test');
    });
  });

  // ── parseTestSummary ──

  describe('parseTestSummary', () => {
    it('parses vitest output', () => {
      const output = 'Tests  42 passed (42)';
      expect(parseTestSummary(output)).toBe('42 passed, 0 failed');
    });

    it('parses vitest output with failures', () => {
      const output = 'Tests  40 passed | 2 failed';
      expect(parseTestSummary(output)).toBe('40 passed, 2 failed');
    });

    it('parses pytest output', () => {
      const output = '====== 10 passed, 1 failed in 2.5s ======';
      expect(parseTestSummary(output)).toBe('10 passed, 1 failed');
    });

    it('returns default for unrecognized output', () => {
      expect(parseTestSummary('unknown output')).toBe('test execution completed');
    });
  });

  // ── runTests ──

  describe('runTests', () => {
    it('returns passed=true when command succeeds', () => {
      execFileSync.mockReturnValue('Tests  5 passed');

      const result = runTests('npm test', '/project');

      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('returns passed=false when command fails', () => {
      const err = new Error('test failed');
      err.stdout = 'Tests  3 passed | 2 failed';
      err.stderr = '';
      err.status = 1;
      execFileSync.mockImplementation(() => { throw err; });

      const result = runTests('npm test', '/project');

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  // ── executePrePRTests ──

  describe('executePrePRTests', () => {
    it('skips when PRE_PR_TESTS is disabled', async () => {
      config.prePrTests = false;

      const report = await executePrePRTests({ cwd: '/project' });

      expect(report.success).toBe(true);
      expect(report.skipped).toBe(true);
      expect(report.reason).toContain('disabled');
    });

    it('skips when no cwd provided', async () => {
      const report = await executePrePRTests({});

      expect(report.skipped).toBe(true);
    });

    it('skips when no test command detected', async () => {
      existsSync.mockReturnValue(false);

      const report = await executePrePRTests({ cwd: '/project' });

      expect(report.skipped).toBe(true);
      expect(report.reason).toContain('No test command');
    });

    it('returns success when tests pass on first attempt', async () => {
      config.prePrTestCmd = 'npm test';
      execFileSync.mockReturnValue('Tests  10 passed');

      const report = await executePrePRTests({ cwd: '/project' });

      expect(report.success).toBe(true);
      expect(report.passed).toBe(true);
      expect(report.attempts).toBe(1);
      expect(report.needsManualReview).toBe(false);
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        'tests:pre-pr:passed',
        expect.objectContaining({ metadata: expect.objectContaining({ attempts: 1 }) }),
      );
    });

    it('retries and succeeds after auto-fix', async () => {
      config.prePrTestCmd = 'npm test';

      let callCount = 0;
      execFileSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('fail');
          err.stdout = '2 failed';
          err.stderr = '';
          err.status = 1;
          throw err;
        }
        return 'Tests  10 passed';
      });

      const onFixAttempt = vi.fn().mockResolvedValue({ fixed: true });

      const report = await executePrePRTests({ cwd: '/project', onFixAttempt });

      expect(report.success).toBe(true);
      expect(report.passed).toBe(true);
      expect(report.attempts).toBe(2);
      expect(onFixAttempt).toHaveBeenCalledTimes(1);
    });

    it('marks needsManualReview after max attempts', async () => {
      config.prePrTestCmd = 'npm test';

      const err = new Error('fail');
      err.stdout = '3 failed';
      err.stderr = '';
      err.status = 1;
      execFileSync.mockImplementation(() => { throw err; });

      const onFixAttempt = vi.fn().mockResolvedValue({ fixed: false });

      const report = await executePrePRTests({ cwd: '/project', onFixAttempt });

      expect(report.success).toBe(false);
      expect(report.passed).toBe(false);
      expect(report.attempts).toBe(3);
      expect(report.needsManualReview).toBe(true);
      expect(onFixAttempt).toHaveBeenCalledTimes(2); // attempts 1 and 2 (not 3)
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        'tests:pre-pr:failed',
        expect.objectContaining({ metadata: expect.objectContaining({ needsManualReview: true }) }),
      );
    });

    it('emits start event', async () => {
      config.prePrTestCmd = 'npm test';
      execFileSync.mockReturnValue('Tests  5 passed');

      await executePrePRTests({ cwd: '/project' });

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        'tests:pre-pr:start',
        expect.objectContaining({ metadata: { testCommand: 'npm test', cwd: '/project' } }),
      );
    });
  });
});
