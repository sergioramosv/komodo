import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    canaryBranch: 'staging',
    canaryWaitMinutes: 1,
    canaryAutoPromote: true,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    CANARY_STAGING_CREATED: 'canary:staging:created',
    CANARY_CI_WAITING: 'canary:ci:waiting',
    CANARY_CI_PASSED: 'canary:ci:passed',
    CANARY_CI_FAILED: 'canary:ci:failed',
    CANARY_AUTO_FIX_ATTEMPT: 'canary:auto-fix:attempt',
    CANARY_AUTO_FIX_SUCCEEDED: 'canary:auto-fix:succeeded',
    CANARY_AUTO_FIX_FAILED: 'canary:auto-fix:failed',
    CANARY_PROMOTED: 'canary:promoted',
    CANARY_ROLLED_BACK: 'canary:rolled-back',
  },
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../ci-monitor/ci-monitor.js', () => ({
  listRuns: vi.fn(),
  getFailedLogs: vi.fn(),
}));

vi.mock('../agents/coder.js', () => ({
  fixReviewIssues: vi.fn(),
}));

const { execFileSync } = await import('child_process');
const { listRuns, getFailedLogs } = await import('../ci-monitor/ci-monitor.js');
const { fixReviewIssues } = await import('../agents/coder.js');
const { eventBus } = await import('../events/event-bus.js');
const { runCanaryMerge } = await import('./canary-merge.js');

const TASK_SPEC = {
  taskId: 'abc123',
  title: 'Test task',
  branchName: 'feature/task-abc123-test',
};
const REPO = 'owner/repo';
const CWD = '/fake/cwd';
const PR_NUMBER = 42;

/** CI run that passed */
const PASSED_RUN = { databaseId: 1, status: 'completed', conclusion: 'success' };
/** CI run that failed */
const FAILED_RUN = { databaseId: 2, status: 'completed', conclusion: 'failure' };
/** CI run still in progress */
const PENDING_RUN = { databaseId: 3, status: 'in_progress', conclusion: null };

function makeExecMock({ sha = 'deadbeef', mergeConflict = false, mergeStatus = 200 } = {}) {
  execFileSync.mockImplementation((cmd, args) => {
    if (cmd === 'git') {
      if (args.includes('rev-parse')) return sha;
      if (args.includes('fetch')) return '';
      return '';
    }
    if (cmd === 'gh') {
      // DELETE staging branch ref — always OK
      if (args.includes('DELETE')) return '';
      // POST refs (create branch)
      if (args.includes('POST') && args.some(a => a?.includes('/git/refs'))) return JSON.stringify({ ref: 'refs/heads/staging/abc123' });
      // POST merges (merge main into staging)
      if (args.includes('POST') && args.some(a => a?.includes('/merges'))) {
        if (mergeConflict) {
          const err = new Error('409 Conflict');
          throw err;
        }
        return JSON.stringify({ sha: 'merge-sha' });
      }
      // PATCH refs (update staging after auto-fix)
      if (args.includes('PATCH')) return JSON.stringify({ object: { sha } });
      // pr merge (promote)
      if (args.includes('merge')) return '';
      return '';
    }
    return '';
  });
}

describe('runCanaryMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Step 1: Staging branch creation ─────────────────────────────────

  it('returns failure when staging branch creation fails', async () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args.includes('fetch')) return '';
      if (cmd === 'gh' && args.includes('DELETE')) return '';
      // rev-parse for feature SHA
      if (cmd === 'git' && args.includes('rev-parse')) return 'sha123';
      // POST to create branch fails
      if (cmd === 'gh' && args.includes('POST')) throw new Error('network error');
      return '';
    });

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.promoted).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(result.reason).toMatch(/staging-create-failed/);
  });

  // ── Step 2: Pre-merge validation (conflict detection) ────────────────

  it('rolls back when merge main→staging has conflicts', async () => {
    makeExecMock({ mergeConflict: true });

    listRuns.mockReturnValue([]);

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toBe('merge-conflict');
    expect(eventBus.emitEvent).toHaveBeenCalledWith('canary:rolled-back', expect.any(Object));
  });

  // ── Step 3: CI polling ───────────────────────────────────────────────

  it('promotes to main when CI passes on the first poll', async () => {
    makeExecMock();
    listRuns.mockReturnValue([PASSED_RUN]);

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.promoted).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(result.autoFixAttempts).toBe(0);
    expect(eventBus.emitEvent).toHaveBeenCalledWith('canary:promoted', expect.any(Object));
  });

  it('waits when CI run is still in progress and retries', async () => {
    makeExecMock();
    listRuns
      .mockReturnValueOnce([PENDING_RUN])
      .mockReturnValue([PASSED_RUN]);

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.promoted).toBe(true);
  });

  it('rolls back when CI times out (no runs found)', async () => {
    makeExecMock();
    listRuns.mockReturnValue([]); // never returns runs
    fixReviewIssues.mockResolvedValue({ success: false });

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
  });

  // ── Step 4 & 5: Auto-fix loop ─────────────────────────────────────────

  it('attempts auto-fix when CI fails and succeeds on first attempt', async () => {
    makeExecMock();
    getFailedLogs.mockReturnValue('Error: test failed');
    listRuns
      .mockReturnValueOnce([FAILED_RUN]) // initial CI check
      .mockReturnValue([PASSED_RUN]); // after auto-fix

    fixReviewIssues.mockResolvedValue({ success: true });

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.promoted).toBe(true);
    expect(result.autoFixAttempts).toBe(1);
    expect(fixReviewIssues).toHaveBeenCalledTimes(1);
    expect(eventBus.emitEvent).toHaveBeenCalledWith('canary:auto-fix:succeeded', expect.any(Object));
  });

  it('rolls back when auto-fix fails', async () => {
    makeExecMock();
    getFailedLogs.mockReturnValue('Error: build failed');
    listRuns.mockReturnValue([FAILED_RUN]);

    fixReviewIssues.mockResolvedValue({ success: false });

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.autoFixAttempts).toBe(1);
    expect(eventBus.emitEvent).toHaveBeenCalledWith('canary:auto-fix:failed', expect.any(Object));
    expect(eventBus.emitEvent).toHaveBeenCalledWith('canary:rolled-back', expect.any(Object));
  });

  it('rolls back when auto-fix throws an exception', async () => {
    makeExecMock();
    getFailedLogs.mockReturnValue('Error: crash');
    listRuns.mockReturnValue([FAILED_RUN]);

    fixReviewIssues.mockRejectedValue(new Error('unexpected crash'));

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
  });

  // ── Step 6: Rollback ─────────────────────────────────────────────────

  it('rolls back staging branch when CI fails after exhausting auto-fix', async () => {
    makeExecMock();
    getFailedLogs.mockReturnValue('Error: persistent failure');
    listRuns.mockReturnValue([FAILED_RUN]); // always failing

    fixReviewIssues.mockResolvedValue({ success: false });

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toBe('ci-failed-on-staging');

    // Should have called DELETE to remove staging branch
    const deleteCalls = execFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'gh' && args.includes('DELETE'),
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  // ── Step 7: Promote to main ──────────────────────────────────────────

  it('does not auto-promote when CANARY_AUTO_PROMOTE=false', async () => {
    const { config } = await import('../config.js');
    config.canaryAutoPromote = false;

    makeExecMock();
    listRuns.mockReturnValue([PASSED_RUN]);

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.promoted).toBe(false);
    expect(result.rolledBack).toBe(false);

    // Restore
    config.canaryAutoPromote = true;
  });

  it('rolls back when pr merge (promote) throws', async () => {
    makeExecMock();
    listRuns.mockReturnValue([PASSED_RUN]);

    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args.includes('rev-parse')) return 'sha';
      if (cmd === 'git' && args.includes('fetch')) return '';
      if (cmd === 'gh' && args.includes('DELETE')) return '';
      if (cmd === 'gh' && args.includes('POST') && args.some(a => a?.includes('/git/refs'))) {
        return JSON.stringify({ ref: 'refs/heads/staging/abc123' });
      }
      if (cmd === 'gh' && args.includes('POST') && args.some(a => a?.includes('/merges'))) {
        return JSON.stringify({ sha: 'merge-sha' });
      }
      if (cmd === 'gh' && args.includes('merge')) throw new Error('merge blocked by branch protection');
      return '';
    });

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.promoted).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toMatch(/promote-failed/);
  });

  // ── stagingBranch naming ─────────────────────────────────────────────

  it('uses config.canaryBranch as staging prefix', async () => {
    makeExecMock();
    listRuns.mockReturnValue([PASSED_RUN]);

    const promise = runCanaryMerge({ taskSpec: TASK_SPEC, prNumber: PR_NUMBER, repo: REPO, cwd: CWD });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.stagingBranch).toBe('staging/abc123');
  });
});
