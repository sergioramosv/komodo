import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeConflictStrategy } from './merge-conflict.js';

// Mock spawnSync
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { spawnSync } = await import('child_process');

describe('mergeConflictStrategy.detect', () => {
  it('detects CONFLICTING mergeStatus', () => {
    expect(mergeConflictStrategy.detect({ errorMessage: '', mergeStatus: 'CONFLICTING' })).toBe(true);
  });

  it('detects DIRTY mergeStatus', () => {
    expect(mergeConflictStrategy.detect({ errorMessage: '', mergeStatus: 'DIRTY' })).toBe(true);
  });

  it('detects merge conflict in error message', () => {
    expect(mergeConflictStrategy.detect({ errorMessage: 'merge conflict detected in file.js' })).toBe(true);
  });

  it('detects conflict markers in output', () => {
    expect(mergeConflictStrategy.detect({ errorMessage: '<<<<<<< HEAD' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(mergeConflictStrategy.detect({ errorMessage: 'network error' })).toBe(false);
  });
});

describe('mergeConflictStrategy.diagnose', () => {
  it('returns requiresRebase: true', () => {
    const result = mergeConflictStrategy.diagnose({ branchName: 'feature/test' });
    expect(result.requiresRebase).toBe(true);
    expect(result.branchName).toBe('feature/test');
  });
});

describe('mergeConflictStrategy.heal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
  });

  it('returns healed=false when no branchName', async () => {
    const result = await mergeConflictStrategy.heal({ errorMessage: 'conflict' });
    expect(result.healed).toBe(false);
    expect(result.action).toBe('no-branch-name');
  });

  it('returns healed=true after successful rebase', async () => {
    const result = await mergeConflictStrategy.heal({
      errorMessage: 'conflict',
      branchName: 'feature/test',
      cwd: '/tmp',
    });
    expect(result.healed).toBe(true);
    expect(result.action).toBe('rebased');
  });

  it('uses spawnSync with array args (no shell injection)', async () => {
    await mergeConflictStrategy.heal({
      errorMessage: 'conflict',
      branchName: 'feature/test; rm -rf /',
      cwd: '/tmp',
    });
    // Verify spawnSync is called with array args, not string interpolation
    const checkoutCall = spawnSync.mock.calls.find(c => c[1] && c[1][0] === 'checkout');
    expect(checkoutCall).toBeDefined();
    expect(checkoutCall[0]).toBe('git');
    expect(checkoutCall[1]).toEqual(['checkout', 'feature/test; rm -rf /']);
  });

  it('returns healed=false when git fetch fails', async () => {
    spawnSync.mockImplementation((cmd, args) => {
      if (args[0] === 'fetch') return { status: 1, stdout: '', stderr: 'fetch error' };
      return { status: 0, stdout: '', stderr: '' };
    });
    const result = await mergeConflictStrategy.heal({
      errorMessage: 'conflict',
      branchName: 'feature/test',
      cwd: '/tmp',
    });
    expect(result.healed).toBe(false);
    expect(result.action).toBe('fetch-failed');
  });

  it('returns healed=false when rebase fails and aborts', async () => {
    spawnSync.mockImplementation((cmd, args) => {
      if (args[0] === 'rebase' && !args.includes('--abort')) {
        return { status: 1, stdout: '', stderr: 'rebase conflict' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    const result = await mergeConflictStrategy.heal({
      errorMessage: 'conflict',
      branchName: 'feature/test',
      cwd: '/tmp',
    });
    expect(result.healed).toBe(false);
    expect(result.action).toBe('rebase-failed');
  });
});
