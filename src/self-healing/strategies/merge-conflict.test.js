import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeConflictStrategy } from './merge-conflict.js';

// Mock execSync
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { execSync } = await import('child_process');

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
    execSync.mockReturnValue('');
  });

  it('returns healed=false when no branchName', async () => {
    const result = await mergeConflictStrategy.heal({ errorMessage: 'conflict' });
    expect(result.healed).toBe(false);
    expect(result.action).toBe('no-branch-name');
  });

  it('returns healed=true after successful rebase', async () => {
    execSync.mockReturnValue('');
    const result = await mergeConflictStrategy.heal({
      errorMessage: 'conflict',
      branchName: 'feature/test',
      cwd: '/tmp',
    });
    expect(result.healed).toBe(true);
    expect(result.action).toBe('rebased');
  });

  it('returns healed=false when git fetch fails', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.includes('fetch')) throw new Error('fetch error');
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
    execSync.mockImplementation((cmd) => {
      if (cmd.includes('rebase') && !cmd.includes('--abort')) throw new Error('rebase conflict');
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
