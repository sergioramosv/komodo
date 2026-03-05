import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    ciMonitor: true,
    ciMonitorTimeoutMinutes: 1,
    autoRevert: true,
    defaultUserId: 'user123',
    defaultUserName: 'TestUser',
    rootDir: '/fake/komodo',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    CI_MONITOR_START: 'ci:monitor:start',
    CI_PASSED: 'ci:passed',
    CI_FAILED: 'ci:failed',
    CI_AUTO_REVERTED: 'ci:auto-reverted',
  },
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('./auto-revert.js', () => ({
  autoRevertPR: vi.fn(),
}));

const { config } = await import('../config.js');
const { execFileSync } = await import('child_process');
const { create, update } = await import('../../skills/planning-task-mcp/src/firebase.js');
const { autoRevertPR } = await import('./auto-revert.js');
const { monitorCi } = await import('./ci-monitor.js');

describe('monitorCi + auto-revert integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.ciMonitor = true;
    config.ciMonitorTimeoutMinutes = 1;
    config.autoRevert = true;
  });

  function setupCiFail({ headSha = 'merge-sha', runId = 500 } = {}) {
    execFileSync.mockImplementation((_cmd, args) => {
      if (args.includes('pr') && args.includes('view')) {
        return JSON.stringify({ mergeCommit: { oid: headSha } });
      }
      if (args.includes('run') && args.includes('list')) {
        return JSON.stringify([{
          databaseId: runId,
          status: 'completed',
          conclusion: 'failure',
          headSha,
          name: 'CI',
        }]);
      }
      if (args.includes('--log-failed')) {
        return 'Error: tests failed';
      }
      return '';
    });
  }

  it('full flow: merge → CI fail → revert → task back to to-do', async () => {
    setupCiFail();
    autoRevertPR.mockReturnValue({ success: true, revertPrNumber: 101 });
    update.mockResolvedValue();

    const result = await monitorCi({
      prNumber: 42,
      repo: 'owner/repo',
      projectId: 'proj-1',
      taskId: 'task-123',
    });

    // CI failure detected
    expect(result.success).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.runId).toBe(500);

    // Auto-revert was called
    expect(autoRevertPR).toHaveBeenCalledWith({
      prNumber: 42,
      repo: 'owner/repo',
      errorLog: expect.stringContaining('tests failed'),
      runId: 500,
      mergeCommitSha: 'merge-sha',
    });

    // Result includes revert info
    expect(result.reverted).toBe(true);
    expect(result.revertPrNumber).toBe(101);

    // Task rolled back to to-do
    expect(update).toHaveBeenCalledWith('tasks', 'task-123', expect.objectContaining({
      status: 'to-do',
      autoRevertNote: expect.stringContaining('Auto-reverted'),
    }));

    // No bug task created (revert succeeded)
    expect(result.bugTaskId).toBeNull();
  });

  it('creates bug task when auto-revert is disabled', async () => {
    config.autoRevert = false;
    setupCiFail({ runId: 600 });
    create.mockResolvedValue('bug-task-id');

    const result = await monitorCi({
      prNumber: 50,
      repo: 'owner/repo',
      projectId: 'proj-1',
      taskId: 'task-456',
    });

    // Auto-revert NOT called
    expect(autoRevertPR).not.toHaveBeenCalled();

    // Bug task was created instead
    expect(result.bugTaskId).toBe('bug-task-id');
    expect(result.reverted).toBe(false);
  });

  it('creates bug task when auto-revert fails', async () => {
    setupCiFail({ runId: 700 });
    autoRevertPR.mockReturnValue({ success: false, error: 'revert failed' });
    create.mockResolvedValue('fallback-bug-id');

    const result = await monitorCi({
      prNumber: 60,
      repo: 'owner/repo',
      projectId: 'proj-1',
      taskId: 'task-789',
    });

    // Auto-revert was attempted but failed
    expect(autoRevertPR).toHaveBeenCalled();

    // Bug task created as fallback
    expect(result.bugTaskId).toBe('fallback-bug-id');
    expect(result.reverted).toBe(false);
  });

  it('does not rollback task when no taskId provided', async () => {
    setupCiFail();
    autoRevertPR.mockReturnValue({ success: true, revertPrNumber: 102 });

    const result = await monitorCi({
      prNumber: 42,
      repo: 'owner/repo',
      projectId: 'proj-1',
      // no taskId
    });

    expect(result.reverted).toBe(true);
    // update should NOT be called (no taskId to rollback)
    expect(update).not.toHaveBeenCalled();
  });

  it('emits ci:failed event before auto-revert', async () => {
    const { eventBus } = await import('../events/event-bus.js');

    setupCiFail();
    autoRevertPR.mockReturnValue({ success: true, revertPrNumber: 103 });

    await monitorCi({
      prNumber: 42,
      repo: 'owner/repo',
      projectId: 'proj-1',
      taskId: 'task-123',
    });

    expect(eventBus.emitEvent).toHaveBeenCalledWith('ci:failed', expect.objectContaining({
      metadata: expect.objectContaining({ prNumber: 42, runId: 500 }),
    }));
  });
});
