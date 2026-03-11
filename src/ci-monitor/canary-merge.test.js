import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    canaryBranch: 'staging',
    canaryWaitMinutes: 10,
    canaryAutoPromote: false,
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
    CANARY_MERGE_START: 'canary:merge-start',
    CANARY_CI_PASSED: 'canary:ci-passed',
    CANARY_CI_FAILED: 'canary:ci-failed',
    CANARY_PROMOTED: 'canary:promoted',
    CANARY_REVERTED: 'canary:reverted',
    CANARY_AUTO_FIX_START: 'canary:auto-fix-start',
    CANARY_AUTO_FIX_SUCCESS: 'canary:auto-fix-success',
    CANARY_AUTO_FIX_FAILED: 'canary:auto-fix-failed',
  },
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  update: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./ci-monitor.js', () => ({
  runGhCommand: vi.fn(),
  listRuns: vi.fn(),
  getFailedLogs: vi.fn(),
  findRunForCommit: vi.fn(),
}));

vi.mock('./canary-auto-fix.js', () => ({
  runCanaryAutoFix: vi.fn(),
}));

const { config } = await import('../config.js');
const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { execFileSync } = await import('child_process');
const { update } = await import('../../skills/planning-task-mcp/src/firebase.js');
const { runGhCommand, listRuns, getFailedLogs, findRunForCommit } = await import('./ci-monitor.js');
const { runCanaryAutoFix } = await import('./canary-auto-fix.js');
const { canaryMerge, detectPreMergeConflicts } = await import('./canary-merge.js');

/** Base task spec used across tests. */
const BASE_TASK = {
  branchName: 'feature/my-feature',
  acceptanceCriteria: ['AC1'],
  implementationPlan: 'plan',
};

/** Options passed to canaryMerge() in most tests. */
const BASE_OPTS = {
  prNumber: 42,
  repo: 'owner/repo',
  taskSpec: BASE_TASK,
  cwd: '/fake/komodo',
  projectId: 'proj-1',
  taskId: 'task-abc',
};

// ─── git mock helpers ────────────────────────────────────────────────────────

function setupGitMocks({ headSha = 'abc123', mergeThrows = false } = {}) {
  execFileSync.mockImplementation((cmd, args) => {
    if (cmd !== 'git' && cmd !== 'npm') {
      throw new Error(`Unexpected execFileSync cmd: ${cmd} ${args}`);
    }
    if (cmd === 'npm') return ''; // local test suite — pass
    // git commands
    const sub = args[0];
    if (sub === 'rev-parse' && args.includes('HEAD')) return headSha;
    if (sub === 'rev-parse' && args.includes('--abbrev-ref')) return 'main';
    if (sub === 'fetch') return '';
    if (sub === 'checkout') return '';
    if (sub === 'reset') return '';
    if (sub === 'push') return '';
    if (sub === 'branch') return '';
    if (sub === 'merge') {
      if (mergeThrows) throw new Error('merge conflict');
      return '';
    }
    return '';
  });
}

function setupGhMocks({ stagingPrNumber = 10, existingPr = null, mergeThrows = false } = {}) {
  runGhCommand.mockImplementation((args, _opts) => {
    // pr list (existing staging PR check)
    if (args.includes('list') && args.includes('--json')) {
      return existingPr ? String(existingPr) : '';
    }
    // pr create → return URL
    if (args.includes('create')) {
      return `https://github.com/owner/repo/pull/${stagingPrNumber}`;
    }
    // pr merge
    if (args.includes('merge')) {
      if (mergeThrows) throw new Error('merge failed');
      return '';
    }
    // api refs (remoteBranchExists)
    if (args[0] === 'api') return '{"ref":"refs/heads/staging"}';
    return '';
  });
}

function setupCiPassed(sha = 'abc123') {
  const run = { databaseId: 99, status: 'completed', conclusion: 'success' };
  listRuns.mockReturnValue([run]);
  findRunForCommit.mockReturnValue(run);
}

function setupCiFailed(sha = 'abc123') {
  const run = { databaseId: 88, status: 'completed', conclusion: 'failure' };
  listRuns.mockReturnValue([run]);
  findRunForCommit.mockReturnValue(run);
  getFailedLogs.mockReturnValue('Error: test failed');
}

// ─── detectPreMergeConflicts ──────────────────────────────────────────────────

describe('detectPreMergeConflicts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns conflicting:false when merge succeeds without conflict', () => {
    execFileSync.mockReturnValue('');

    const result = detectPreMergeConflicts('feature/x', '/cwd');

    expect(result.conflicting).toBe(false);
    expect(result.message).toBe('No conflicts detected');
  });

  it('returns conflicting:true when merge throws', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args[0] === 'merge' && !args.includes('--abort')) {
        throw new Error('CONFLICT (content)');
      }
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'main';
      return '';
    });

    const result = detectPreMergeConflicts('feature/x', '/cwd');

    expect(result.conflicting).toBe(true);
    expect(result.message).toContain('CONFLICT');
  });

  it('always restores original branch in finally block', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'feature/original';
      return '';
    });

    detectPreMergeConflicts('feature/x', '/cwd');

    const checkoutCalls = execFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'git' && args[0] === 'checkout' && args[1] === 'feature/original',
    );
    expect(checkoutCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('always deletes temp branch in finally block', () => {
    execFileSync.mockReturnValue('main');

    detectPreMergeConflicts('feature/x', '/cwd');

    const deleteCalls = execFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'git' && args[0] === 'branch' && args.includes('-D'),
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    expect(deleteCalls[0][1].some(a => a.startsWith('canary-precheck-'))).toBe(true);
  });
});

// ─── canaryMerge ─────────────────────────────────────────────────────────────

describe('canaryMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.canaryBranch = 'staging';
    config.canaryWaitMinutes = 10;
    config.canaryAutoPromote = false;
  });

  afterEach(() => vi.restoreAllMocks());

  // ── local test failure ────────────────────────────────────────────────────

  it('returns failure when local tests fail before merge', async () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'main';
      if (cmd === 'git') return '';
      if (cmd === 'npm') throw new Error('test suite failed');
      return '';
    });

    const result = await canaryMerge(BASE_OPTS);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Pre-merge local tests failed');
  });

  // ── staging branch setup failure ──────────────────────────────────────────

  it('returns failure when staging branch cannot be prepared', async () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'npm') return ''; // tests pass
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'main';
      if (cmd === 'git' && args[0] === 'fetch') throw new Error('network error');
      return '';
    });
    runGhCommand.mockReturnValue('{}');

    const result = await canaryMerge(BASE_OPTS);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not prepare staging branch');
  });

  // ── CANARY_WAIT_MINUTES=0 + CANARY_AUTO_PROMOTE bypass ───────────────────

  it('warns loudly and emits ci-bypassed event when CANARY_WAIT_MINUTES=0 + CANARY_AUTO_PROMOTE=true', async () => {
    config.canaryWaitMinutes = 0;
    config.canaryAutoPromote = true;

    setupGitMocks();
    setupGhMocks({ stagingPrNumber: 20 });

    const { logger } = await import('../utils/logger.js');

    const result = await canaryMerge(BASE_OPTS);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('CI validation is being bypassed'),
      'CANARY-MERGE',
    );
    const bypassEvent = eventBus.emitEvent.mock.calls.find(
      ([type]) => type === 'canary:ci-bypassed',
    );
    expect(bypassEvent).toBeDefined();
    expect(result.promoted).toBe(true);
  });

  it('does NOT bypass CI when CANARY_WAIT_MINUTES > 0', async () => {
    config.canaryWaitMinutes = 10;
    config.canaryAutoPromote = true;

    setupGitMocks();
    setupGhMocks({ stagingPrNumber: 30 });
    setupCiPassed();

    await canaryMerge(BASE_OPTS);

    // CI poll must have been called (listRuns)
    expect(listRuns).toHaveBeenCalled();
  });

  // ── CI passes + auto-promote disabled ────────────────────────────────────

  it('returns success:true, promoted:false when CI passes and CANARY_AUTO_PROMOTE=false', async () => {
    setupGitMocks();
    setupGhMocks();
    setupCiPassed();

    const result = await canaryMerge(BASE_OPTS);

    expect(result.success).toBe(true);
    expect(result.promoted).toBe(false);
    expect(result.reverted).toBe(false);
    expect(result.autoFixed).toBe(false);
  });

  // ── CI passes + auto-promote enabled ─────────────────────────────────────

  it('promotes to main when CI passes and CANARY_AUTO_PROMOTE=true', async () => {
    config.canaryAutoPromote = true;

    setupGitMocks();
    setupGhMocks({ stagingPrNumber: 55 });
    setupCiPassed();

    const result = await canaryMerge(BASE_OPTS);

    expect(result.success).toBe(true);
    expect(result.promoted).toBe(true);
    expect(result.stagingPrNumber).toBe(55);
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.CANARY_PROMOTED,
      expect.objectContaining({ metadata: expect.objectContaining({ stagingPrNumber: 55 }) }),
    );
  });

  // ── promotion failure → staging cleanup ───────────────────────────────────

  it('reverts staging and rolls back task when promoteToMain() fails', async () => {
    config.canaryAutoPromote = true;

    setupGitMocks();
    setupGhMocks({ stagingPrNumber: 60, mergeThrows: true });
    setupCiPassed();

    const result = await canaryMerge(BASE_OPTS);

    expect(result.success).toBe(false);
    expect(result.promoted).toBe(false);
    expect(result.reverted).toBe(true);

    // revertStaging pushes --force-with-lease
    const pushCalls = execFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'git' && args[0] === 'push' && args.includes('--force-with-lease'),
    );
    expect(pushCalls.length).toBeGreaterThanOrEqual(1);

    // Firebase rollback
    expect(update).toHaveBeenCalledWith(
      'tasks',
      BASE_OPTS.taskId,
      expect.objectContaining({ status: 'to-do' }),
    );

    // CANARY_REVERTED event
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.CANARY_REVERTED,
      expect.objectContaining({ metadata: expect.objectContaining({ stagingBranch: 'staging' }) }),
    );
  });

  it('reverts staging when staging PR cannot be created', async () => {
    config.canaryAutoPromote = true;

    setupGitMocks();
    // runGhCommand always throws → createStagingPr returns null
    runGhCommand.mockImplementation(() => { throw new Error('gh unavailable'); });
    setupCiPassed();

    const result = await canaryMerge(BASE_OPTS);

    expect(result.success).toBe(false);
    expect(result.reverted).toBe(true);
    expect(update).toHaveBeenCalledWith('tasks', BASE_OPTS.taskId, expect.objectContaining({ status: 'to-do' }));
  });

  // ── CI fails + auto-fix succeeds ─────────────────────────────────────────

  it('runs auto-fix when CI fails and promotes if fix passes CI', async () => {
    config.canaryAutoPromote = true;

    setupGitMocks();
    setupGhMocks({ stagingPrNumber: 70 });

    // First CI poll fails; second (after fix) passes
    const failRun = { databaseId: 1, status: 'completed', conclusion: 'failure' };
    const passRun = { databaseId: 2, status: 'completed', conclusion: 'success' };
    listRuns
      .mockReturnValueOnce([failRun])
      .mockReturnValueOnce([passRun]);
    findRunForCommit
      .mockReturnValueOnce(failRun)
      .mockReturnValueOnce(passRun);
    getFailedLogs.mockReturnValue('npm test failed');
    runCanaryAutoFix.mockResolvedValue({ fixed: true });

    const result = await canaryMerge(BASE_OPTS);

    expect(runCanaryAutoFix).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.promoted).toBe(true);
    expect(result.autoFixed).toBe(true);
  });

  // ── CI fails + auto-fix fails → revert ───────────────────────────────────

  it('reverts staging and rolls back task when CI fails and auto-fix does not fix it', async () => {
    setupGitMocks();
    setupGhMocks();
    setupCiFailed();
    runCanaryAutoFix.mockResolvedValue({ fixed: false, error: 'could not fix' });

    const result = await canaryMerge(BASE_OPTS);

    expect(result.success).toBe(false);
    expect(result.reverted).toBe(true);
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.CANARY_REVERTED,
      expect.any(Object),
    );
    expect(update).toHaveBeenCalledWith('tasks', BASE_OPTS.taskId, expect.objectContaining({ status: 'to-do' }));
  });

  // ── reuses existing staging PR ─────────────────────────────────────────────

  it('reuses existing staging PR instead of creating a new one', async () => {
    config.canaryAutoPromote = true;

    setupGitMocks();
    setupGhMocks({ stagingPrNumber: 77, existingPr: 77 });
    setupCiPassed();

    const result = await canaryMerge(BASE_OPTS);

    expect(result.stagingPrNumber).toBe(77);
    // pr create should NOT have been called
    const createCalls = runGhCommand.mock.calls.filter(([args]) => args.includes('create'));
    expect(createCalls).toHaveLength(0);
  });

  // ── CANARY_MERGE_START event ──────────────────────────────────────────────

  it('emits CANARY_MERGE_START at the beginning', async () => {
    setupGitMocks();
    setupGhMocks();
    setupCiPassed();

    await canaryMerge(BASE_OPTS);

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      EVENT_TYPES.CANARY_MERGE_START,
      expect.objectContaining({ metadata: expect.objectContaining({ prNumber: 42 }) }),
    );
  });
});
