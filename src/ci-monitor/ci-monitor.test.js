import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    ciMonitor: true,
    ciMonitorTimeoutMinutes: 1,
    defaultUserId: 'user123',
    defaultUserName: 'TestUser',
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
    CI_MONITOR_START: 'ci:monitor:start',
    CI_PASSED: 'ci:passed',
    CI_FAILED: 'ci:failed',
  },
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  create: vi.fn(),
}));

const { config } = await import('../config.js');
const { eventBus } = await import('../events/event-bus.js');
const { execFileSync } = await import('child_process');
const { create } = await import('../../skills/planning-task-mcp/src/firebase.js');
const {
  runGhCommand,
  listRuns,
  getFailedLogs,
  findRunForCommit,
  getMergeCommitSha,
  createCiBugTask,
  monitorCi,
} = await import('./ci-monitor.js');

describe('ci-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.ciMonitor = true;
    config.ciMonitorTimeoutMinutes = 1;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── runGhCommand ──

  describe('runGhCommand', () => {
    it('parses JSON output from gh', () => {
      execFileSync.mockReturnValue(JSON.stringify([{ id: 1 }]));

      const result = runGhCommand(['run', 'list']);

      expect(result).toEqual([{ id: 1 }]);
      expect(execFileSync).toHaveBeenCalledWith('gh', ['run', 'list'], expect.any(Object));
    });

    it('appends --repo when provided', () => {
      execFileSync.mockReturnValue('[]');

      runGhCommand(['run', 'list'], { repo: 'owner/repo' });

      expect(execFileSync).toHaveBeenCalledWith(
        'gh',
        ['run', 'list', '--repo', 'owner/repo'],
        expect.any(Object),
      );
    });

    it('returns raw string when output is not JSON', () => {
      execFileSync.mockReturnValue('not json');

      const result = runGhCommand(['run', 'list']);

      expect(result).toBe('not json');
    });

    it('returns null when output is empty', () => {
      execFileSync.mockReturnValue('');

      const result = runGhCommand(['run', 'list']);

      expect(result).toBeNull();
    });

    it('throws on gh error', () => {
      const err = new Error('fail');
      err.stderr = 'auth error';
      execFileSync.mockImplementation(() => { throw err; });

      expect(() => runGhCommand(['run', 'list'])).toThrow('auth error');
    });
  });

  // ── listRuns ──

  describe('listRuns', () => {
    it('returns parsed runs array', () => {
      const runs = [
        { databaseId: 100, status: 'completed', conclusion: 'success', headSha: 'abc123', name: 'CI' },
      ];
      execFileSync.mockReturnValue(JSON.stringify(runs));

      const result = listRuns('owner/repo', 'main');

      expect(result).toEqual(runs);
      expect(execFileSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['run', 'list', '--branch', 'main', '--repo', 'owner/repo']),
        expect.any(Object),
      );
    });

    it('returns empty array on non-array result', () => {
      execFileSync.mockReturnValue('');

      const result = listRuns('owner/repo', 'main');

      expect(result).toEqual([]);
    });
  });

  // ── getFailedLogs ──

  describe('getFailedLogs', () => {
    it('returns truncated log output', () => {
      execFileSync.mockReturnValue('Error: test failed\nStack trace...');

      const result = getFailedLogs('owner/repo', 100);

      expect(result).toContain('Error: test failed');
      expect(execFileSync).toHaveBeenCalledWith(
        'gh',
        ['run', 'view', '100', '--repo', 'owner/repo', '--log-failed'],
        expect.any(Object),
      );
    });

    it('returns fallback message on error', () => {
      execFileSync.mockImplementation(() => { throw new Error('not found'); });

      const result = getFailedLogs('owner/repo', 999);

      expect(result).toContain('could not fetch logs');
    });
  });

  // ── findRunForCommit ──

  describe('findRunForCommit', () => {
    it('finds run matching SHA', () => {
      const runs = [
        { databaseId: 1, headSha: 'aaa' },
        { databaseId: 2, headSha: 'bbb' },
      ];

      const result = findRunForCommit(runs, 'bbb');

      expect(result).toEqual({ databaseId: 2, headSha: 'bbb' });
    });

    it('returns null when no match', () => {
      const runs = [{ databaseId: 1, headSha: 'aaa' }];

      expect(findRunForCommit(runs, 'zzz')).toBeNull();
    });

    it('returns null for empty inputs', () => {
      expect(findRunForCommit([], 'abc')).toBeNull();
      expect(findRunForCommit(null, 'abc')).toBeNull();
      expect(findRunForCommit([], null)).toBeNull();
    });
  });

  // ── getMergeCommitSha ──

  describe('getMergeCommitSha', () => {
    it('returns SHA from PR view', () => {
      execFileSync.mockReturnValue(JSON.stringify({ mergeCommit: { oid: 'sha123' } }));

      const result = getMergeCommitSha('owner/repo', 42);

      expect(result).toBe('sha123');
    });

    it('returns null when mergeCommit is null', () => {
      execFileSync.mockReturnValue(JSON.stringify({ mergeCommit: null }));

      expect(getMergeCommitSha('owner/repo', 42)).toBeNull();
    });

    it('returns null on error', () => {
      execFileSync.mockImplementation(() => { throw new Error('not found'); });

      expect(getMergeCommitSha('owner/repo', 42)).toBeNull();
    });
  });

  // ── createCiBugTask ──

  describe('createCiBugTask', () => {
    it('creates a task with correct data', async () => {
      create.mockResolvedValue('task-abc');

      const taskId = await createCiBugTask({
        prNumber: 42,
        runId: 100,
        errorLog: 'test failure output',
        projectId: 'proj-1',
        repo: 'owner/repo',
      });

      expect(taskId).toBe('task-abc');
      expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
        projectId: 'proj-1',
        title: '[CI Bug] Pipeline failed after merging PR #42',
        status: 'to-do',
        source: 'ci-monitor',
        originPrNumber: 42,
        ciRunId: 100,
      }));
    });

    it('returns null on create failure', async () => {
      create.mockRejectedValue(new Error('db error'));

      const taskId = await createCiBugTask({
        prNumber: 42,
        runId: 100,
        errorLog: 'error',
        projectId: 'proj-1',
        repo: 'owner/repo',
      });

      expect(taskId).toBeNull();
    });
  });

  // ── monitorCi ──

  describe('monitorCi', () => {
    it('skips when CI_MONITOR is disabled', async () => {
      config.ciMonitor = false;

      const result = await monitorCi({ prNumber: 1, repo: 'o/r', projectId: 'p' });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('disabled');
    });

    it('skips when no repo specified', async () => {
      const result = await monitorCi({ prNumber: 1, repo: '', projectId: 'p' });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('returns success when CI passes', async () => {
      const completedRun = {
        databaseId: 200,
        status: 'completed',
        conclusion: 'success',
        headSha: 'merge-sha',
        name: 'CI',
      };

      // First call: getMergeCommitSha -> pr view
      // Second call: listRuns -> run list
      let callIndex = 0;
      execFileSync.mockImplementation((_cmd, args) => {
        callIndex++;
        if (args.includes('pr') && args.includes('view')) {
          return JSON.stringify({ mergeCommit: { oid: 'merge-sha' } });
        }
        if (args.includes('run') && args.includes('list')) {
          return JSON.stringify([completedRun]);
        }
        return '';
      });

      const result = await monitorCi({ prNumber: 42, repo: 'o/r', projectId: 'p' });

      expect(result.success).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.runId).toBe(200);
      expect(eventBus.emitEvent).toHaveBeenCalledWith('ci:passed', expect.objectContaining({
        metadata: expect.objectContaining({ prNumber: 42, runId: 200 }),
      }));
    });

    it('returns failure and creates bug when CI fails', async () => {
      const failedRun = {
        databaseId: 300,
        status: 'completed',
        conclusion: 'failure',
        headSha: 'merge-sha',
        name: 'CI',
      };

      execFileSync.mockImplementation((_cmd, args) => {
        if (args.includes('pr') && args.includes('view')) {
          return JSON.stringify({ mergeCommit: { oid: 'merge-sha' } });
        }
        if (args.includes('run') && args.includes('list')) {
          return JSON.stringify([failedRun]);
        }
        if (args.includes('run') && args.includes('view') && args.includes('--log-failed')) {
          return 'Error: npm test failed\nexit code 1';
        }
        return '';
      });

      create.mockResolvedValue('bug-task-id');

      const result = await monitorCi({ prNumber: 42, repo: 'o/r', projectId: 'p' });

      expect(result.success).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.runId).toBe(300);
      expect(result.errorLog).toContain('npm test failed');
      expect(result.bugTaskId).toBe('bug-task-id');
      expect(eventBus.emitEvent).toHaveBeenCalledWith('ci:failed', expect.objectContaining({
        metadata: expect.objectContaining({ prNumber: 42, runId: 300 }),
      }));
    });

    it('uses provided mergeCommitSha instead of fetching', async () => {
      const completedRun = {
        databaseId: 400,
        status: 'completed',
        conclusion: 'success',
        headSha: 'provided-sha',
        name: 'CI',
      };

      execFileSync.mockImplementation((_cmd, args) => {
        // Should NOT call pr view since SHA is provided
        if (args.includes('pr') && args.includes('view')) {
          throw new Error('Should not fetch PR view when SHA is provided');
        }
        if (args.includes('run') && args.includes('list')) {
          return JSON.stringify([completedRun]);
        }
        return '';
      });

      const result = await monitorCi({
        prNumber: 42,
        repo: 'o/r',
        projectId: 'p',
        mergeCommitSha: 'provided-sha',
      });

      expect(result.success).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('times out when no matching run completes', async () => {
      // Use a very short timeout for testing
      config.ciMonitorTimeoutMinutes = 0; // 0 minutes = immediate timeout

      const result = await monitorCi({ prNumber: 42, repo: 'o/r', projectId: 'p', mergeCommitSha: 'abc' });

      expect(result.success).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.runId).toBeNull();
    });

    it('emits CI_MONITOR_START event', async () => {
      config.ciMonitorTimeoutMinutes = 0;

      await monitorCi({ prNumber: 42, repo: 'o/r', projectId: 'p', mergeCommitSha: 'abc' });

      expect(eventBus.emitEvent).toHaveBeenCalledWith('ci:monitor:start', expect.objectContaining({
        metadata: { prNumber: 42, repo: 'o/r' },
      }));
    });
  });
});
