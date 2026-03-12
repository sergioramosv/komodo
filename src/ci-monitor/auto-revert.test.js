import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    autoRevert: true,
    rootDir: '/fake/komodo',
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
    CI_AUTO_REVERTED: 'ci:auto-reverted',
  },
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const { config } = await import('../config.js');
const { eventBus } = await import('../events/event-bus.js');
const { execFileSync } = await import('child_process');
const { autoRevertPR } = await import('./auto-revert.js');

/**
 * Helper: set up execFileSync mock to handle both gh and git commands.
 */
function setupMocks({ mergeCommitSha = 'abc123', parentCount = '1', prUrl = 'https://github.com/o/r/pull/99' } = {}) {
  execFileSync.mockImplementation((cmd, args) => {
    if (cmd === 'gh') {
      if (args.includes('pr') && args.includes('view')) {
        return JSON.stringify({ mergeCommit: { oid: mergeCommitSha } });
      }
      if (args[0] === 'api' && args[1]?.includes('/git/commits/')) {
        return parentCount;
      }
      if (args.includes('pr') && args.includes('create')) {
        return prUrl;
      }
      if (args.includes('pr') && args.includes('merge')) {
        return '';
      }
      return '';
    }
    if (cmd === 'git' && args[0] === 'rev-parse') {
      return 'main';
    }
    return '';
  });
}

describe('auto-revert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.autoRevert = true;
    config.rootDir = '/fake/komodo';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips when AUTO_REVERT is disabled', () => {
    config.autoRevert = false;

    const result = autoRevertPR({
      prNumber: 42, repo: 'owner/repo', errorLog: 'err', runId: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('returns error when merge commit SHA cannot be found', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'gh' && args.includes('pr') && args.includes('view')) {
        return JSON.stringify({ mergeCommit: null });
      }
      return '';
    });

    const result = autoRevertPR({
      prNumber: 42, repo: 'owner/repo', errorLog: 'err', runId: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find merge commit');
  });

  it('uses provided mergeCommitSha without fetching PR', () => {
    setupMocks({ prUrl: 'https://github.com/owner/repo/pull/99' });

    const result = autoRevertPR({
      prNumber: 42, repo: 'owner/repo', errorLog: 'err', runId: 100,
      mergeCommitSha: 'provided-sha',
    });

    expect(result.success).toBe(true);
    expect(result.revertPrNumber).toBe(99);

    const ghPrViewCalls = execFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'gh' && args.includes('pr') && args.includes('view'),
    );
    expect(ghPrViewCalls).toHaveLength(0);
  });

  it('full flow: revert squash merge → open PR → auto-merge', () => {
    setupMocks({
      mergeCommitSha: 'abc123',
      parentCount: '1',
      prUrl: 'https://github.com/owner/repo/pull/55',
    });

    const result = autoRevertPR({
      prNumber: 42, repo: 'owner/repo', errorLog: 'test failed', runId: 200,
    });

    expect(result.success).toBe(true);
    expect(result.revertPrNumber).toBe(55);

    const gitCalls = execFileSync.mock.calls.filter(([cmd]) => cmd === 'git');
    expect(gitCalls).toHaveLength(7);
    expect(gitCalls[0][1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(gitCalls[1][1]).toEqual(['fetch', 'origin', 'main']);
    expect(gitCalls[2][1]).toEqual(['checkout', '-b', 'revert-pr-42', 'origin/main']);
    expect(gitCalls[3][1]).toEqual(['revert', '--no-edit', 'abc123']);
    expect(gitCalls[4][1]).toEqual(['push', 'origin', 'revert-pr-42']);
    expect(gitCalls[5][1]).toEqual(['checkout', 'main']);
    expect(gitCalls[6][1]).toEqual(['branch', '-D', 'revert-pr-42']);

    expect(eventBus.emitEvent).toHaveBeenCalledWith('ci:auto-reverted', {
      metadata: {
        originalPrNumber: 42,
        revertPrNumber: 55,
        repo: 'owner/repo',
        runId: 200,
      },
    });
  });

  it('uses -m 1 for merge commits with 2+ parents', () => {
    setupMocks({
      mergeCommitSha: 'merge-sha',
      parentCount: '2',
      prUrl: 'https://github.com/owner/repo/pull/60',
    });

    const result = autoRevertPR({
      prNumber: 10, repo: 'owner/repo', errorLog: 'err', runId: 300,
    });

    expect(result.success).toBe(true);

    const revertCall = execFileSync.mock.calls.find(
      ([cmd, args]) => cmd === 'git' && args[0] === 'revert',
    );
    expect(revertCall[1]).toEqual(['revert', '--no-edit', '-m', '1', 'merge-sha']);
  });

  it('creates revert PR with title, error log in body, and AUTO_REVERT tag', () => {
    setupMocks({ prUrl: 'https://github.com/owner/repo/pull/77' });

    autoRevertPR({
      prNumber: 42, repo: 'owner/repo', errorLog: 'npm test failed', runId: 100,
      mergeCommitSha: 'sha1',
    });

    const createCall = execFileSync.mock.calls.find(
      ([cmd, args]) => cmd === 'gh' && args.includes('pr') && args.includes('create'),
    );
    expect(createCall).toBeDefined();

    const args = createCall[1];
    const titleIdx = args.indexOf('--title');
    const bodyIdx = args.indexOf('--body');
    expect(args[titleIdx + 1]).toBe('Revert PR #42: CI failure');
    expect(args[bodyIdx + 1]).toContain('npm test failed');
    expect(args[bodyIdx + 1]).toContain('AUTO_REVERT=true');
  });

  it('merges revert PR with --admin flag to skip reviews', () => {
    setupMocks({ prUrl: 'https://github.com/owner/repo/pull/88' });

    autoRevertPR({
      prNumber: 42, repo: 'owner/repo', errorLog: 'err', runId: 100,
      mergeCommitSha: 'sha1',
    });

    const mergeCall = execFileSync.mock.calls.find(
      ([cmd, args]) => cmd === 'gh' && args.includes('pr') && args.includes('merge'),
    );
    expect(mergeCall).toBeDefined();
    expect(mergeCall[1]).toContain('--admin');
    expect(mergeCall[1]).toContain('88');
  });

  it('cleans up branch on failure and returns error', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'gh') {
        if (args[0] === 'api' && args[1]?.includes('/git/commits/')) {
          return '1';
        }
        return '';
      }
      throw new Error('network error');
    });

    const result = autoRevertPR({
      prNumber: 42, repo: 'owner/repo', errorLog: 'err', runId: 100,
      mergeCommitSha: 'sha1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('network error');
  });

  it('truncates long error logs to 3000 chars in PR body', () => {
    const longLog = 'x'.repeat(5000);
    setupMocks({ prUrl: 'https://github.com/owner/repo/pull/99' });

    autoRevertPR({
      prNumber: 42, repo: 'owner/repo', errorLog: longLog, runId: 100,
      mergeCommitSha: 'sha1',
    });

    const createCall = execFileSync.mock.calls.find(
      ([cmd, args]) => cmd === 'gh' && args.includes('pr') && args.includes('create'),
    );
    const bodyIdx = createCall[1].indexOf('--body');
    const body = createCall[1][bodyIdx + 1];
    const logMatch = body.match(/```\n([\s\S]*?)\n```/);
    expect(logMatch[1].length).toBeLessThanOrEqual(3000);
  });

  it('creates branch named revert-pr-{N}', () => {
    setupMocks({ prUrl: 'https://github.com/owner/repo/pull/50' });

    autoRevertPR({
      prNumber: 77, repo: 'owner/repo', errorLog: 'err', runId: 100,
      mergeCommitSha: 'sha1',
    });

    const checkoutCall = execFileSync.mock.calls.find(
      ([cmd, args]) => cmd === 'git' && args[0] === 'checkout',
    );
    expect(checkoutCall[1]).toContain('revert-pr-77');
  });
});
