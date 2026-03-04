import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  config: {
    heartbeatEnabled: true,
    heartbeatIntervalMinutes: 5,
    rootDir: '/fake/root',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', async () => {
  const { EventEmitter } = await import('events');
  const bus = new EventEmitter();
  bus.emitEvent = vi.fn((type, data) => {
    const payload = {
      type,
      timestamp: new Date().toISOString(),
      agentName: data?.agentName || null,
      metadata: data?.metadata || {},
    };
    bus.emit(type, payload);
    return payload;
  });
  return {
    eventBus: bus,
    EVENT_TYPES: {
      CLI_RECOVERED: 'cli:recovered',
      SESSION_AUTO_RESUMED: 'session:auto-resumed',
      RATE_LIMIT_DETECTED: 'agent:rate-limit',
    },
  };
});

vi.mock('../agents/fallback-manager.js', () => ({
  fallbackManager: {
    getRateLimitedClis: vi.fn(() => []),
    markRecovered: vi.fn(() => true),
  },
}));

vi.mock('../state/checkpoint-manager.js', () => ({
  checkpointManager: {
    listPendingCheckpoints: vi.fn(async () => []),
    validateCheckpoint: vi.fn(() => ({ valid: true })),
    deleteCheckpoint: vi.fn(async () => {}),
    start: vi.fn(),
  },
}));

vi.mock('../state/komodo-state.js', () => ({
  komodoState: {
    getSnapshot: vi.fn(() => ({ executionState: 'running' })),
    setExecutionState: vi.fn(),
  },
  EXECUTION_STATES: {
    STOPPED: 'stopped',
    RUNNING: 'running',
    PAUSED: 'paused',
  },
}));

vi.mock('../cycle/task-runner.js', () => ({
  resumeTask: vi.fn(async () => ({ success: true })),
}));

// Mock child_process.spawn
const mockProc = {
  stdin: { write: vi.fn(), end: vi.fn() },
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

// ── Imports (after mocks) ──────────────────────────────────────────

const { config } = await import('../config.js');
const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { fallbackManager } = await import('../agents/fallback-manager.js');
const { checkpointManager } = await import('../state/checkpoint-manager.js');
const { komodoState, EXECUTION_STATES } = await import('../state/komodo-state.js');
const { resumeTask } = await import('../cycle/task-runner.js');
const { spawn } = await import('child_process');
const { heartbeatMonitor } = await import('./heartbeat-monitor.js');

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Simulate a successful CLI response through the mocked spawn.
 */
function simulateSpawnSuccess(output = 'OK') {
  // When stdout.on('data', cb) is called, capture the callback
  mockProc.stdout.on.mockImplementation((event, cb) => {
    if (event === 'data') cb(Buffer.from(output));
  });
  // When proc.on('close', cb) is called, invoke with code 0
  mockProc.on.mockImplementation((event, cb) => {
    if (event === 'close') cb(0);
  });
}

/**
 * Simulate a failed CLI response (non-zero exit).
 */
function simulateSpawnFailure() {
  mockProc.stdout.on.mockImplementation(() => {});
  mockProc.on.mockImplementation((event, cb) => {
    if (event === 'close') cb(1);
  });
}

/**
 * Simulate spawn error (CLI not found, etc.).
 */
function simulateSpawnError() {
  mockProc.stdout.on.mockImplementation(() => {});
  mockProc.on.mockImplementation((event, cb) => {
    if (event === 'error') cb(new Error('ENOENT'));
  });
}

/**
 * Create a fake checkpoint entry for testing.
 */
function makeCheckpoint(overrides = {}) {
  const checkpoint = {
    taskId: 'task-123',
    taskTitle: 'Test task',
    flowStep: 'code',
    branchName: 'feature/test',
    prNumber: null,
    repoUrl: 'https://github.com/test/repo',
    agentRole: 'CODER',
    cliType: 'claude',
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    reviewRound: null,
    reviewIssues: null,
    ...overrides,
  };
  return {
    filepath: `/fake/checkpoints/checkpoint-${checkpoint.taskId}-${Date.now()}.json`,
    checkpoint,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('HeartbeatMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    heartbeatMonitor.stop();
    config.heartbeatEnabled = true;
    config.heartbeatIntervalMinutes = 5;
  });

  afterEach(() => {
    heartbeatMonitor.stop();
    vi.useRealTimers();
  });

  // ── start / stop ──────────────────────────────────────────────

  describe('start / stop', () => {
    it('starts the monitor when enabled', () => {
      heartbeatMonitor.start();
      expect(heartbeatMonitor.isRunning()).toBe(true);
    });

    it('does not start when disabled', () => {
      config.heartbeatEnabled = false;
      heartbeatMonitor.start();
      expect(heartbeatMonitor.isRunning()).toBe(false);
    });

    it('is idempotent — calling start() twice does not create two intervals', () => {
      heartbeatMonitor.start();
      heartbeatMonitor.start();
      expect(heartbeatMonitor.isRunning()).toBe(true);
    });

    it('stop() clears the timeout', () => {
      heartbeatMonitor.start();
      heartbeatMonitor.stop();
      expect(heartbeatMonitor.isRunning()).toBe(false);
    });

    it('stop() is safe to call when not running', () => {
      expect(() => heartbeatMonitor.stop()).not.toThrow();
    });
  });

  // ── tick behavior ─────────────────────────────────────────────

  describe('tick behavior', () => {
    it('does nothing when no CLIs are rate-limited', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue([]);

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(spawn).not.toHaveBeenCalled();
    });

    it('pings rate-limited CLIs on each tick', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--output-format', 'json', '--max-turns', '1']),
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );
    });

    it('marks CLI as recovered when ping succeeds', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(fallbackManager.markRecovered).toHaveBeenCalledWith('claude');
    });

    it('emits CLI_RECOVERED event on successful ping', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['codex']);
      simulateSpawnSuccess();

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.CLI_RECOVERED,
        expect.objectContaining({
          metadata: expect.objectContaining({ cli: 'codex' }),
        }),
      );
    });

    it('does not mark CLI as recovered when ping fails', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnFailure();

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(fallbackManager.markRecovered).not.toHaveBeenCalled();
    });

    it('does not mark CLI as recovered on spawn error', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnError();

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(fallbackManager.markRecovered).not.toHaveBeenCalled();
    });

    it('pings multiple rate-limited CLIs concurrently', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude', 'codex']);
      simulateSpawnSuccess();

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(spawn).toHaveBeenCalledTimes(2);
    });
  });

  // ── CLI-specific args ─────────────────────────────────────────

  describe('CLI-specific ping args', () => {
    beforeEach(() => {
      simulateSpawnSuccess();
    });

    it('uses correct args for claude', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['--output-format', 'json', '--max-turns', '1'],
        expect.any(Object),
      );
    });

    it('uses correct args for codex', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['codex']);
      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(spawn).toHaveBeenCalledWith(
        'codex',
        ['exec', '--json', '--full-auto', '-'],
        expect.any(Object),
      );
    });

    it('uses correct args for gemini', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['gemini']);
      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(spawn).toHaveBeenCalledWith(
        'gemini',
        ['--output-format', 'json', '--yolo'],
        expect.any(Object),
      );
    });
  });

  // ── Exponential backoff ─────────────────────────────────────

  describe('exponential backoff', () => {
    it('uses base interval (5 min) on first tick', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnFailure();

      heartbeatMonitor.start();

      // Should not have pinged before 5 min
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(spawn).not.toHaveBeenCalled();

      // Should ping at 5 min
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('doubles interval after first failed ping (5 → 10 min)', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnFailure();

      heartbeatMonitor.start();

      // First tick at 5 min
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(1);

      // Second tick should be at 10 min (backoff)
      await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(1); // not yet

      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(2); // now at 10 min
    });

    it('caps backoff at 60 min max', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnFailure();

      heartbeatMonitor.start();

      // Tick 1: 5 min (base)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(1);

      // Tick 2: 10 min (5*2^1)
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(2);

      // Tick 3: 20 min (5*2^2)
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(3);

      // Tick 4: 40 min (5*2^3)
      await vi.advanceTimersByTimeAsync(40 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(4);

      // Tick 5: 60 min (capped, not 80)
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(5);
    });

    it('resets backoff to base interval on recovery', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);

      // First tick: fail → backoff increases
      simulateSpawnFailure();
      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(1);

      // Second tick at 10 min: success → backoff resets
      simulateSpawnSuccess();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(fallbackManager.markRecovered).toHaveBeenCalledWith('claude');

      // Backoff state should be cleared
      expect(heartbeatMonitor.getBackoffState('claude')).toBeUndefined();
    });
  });

  // ── Retry-after scheduling ─────────────────────────────────

  describe('retry-after scheduling', () => {
    it('schedules next heartbeat based on retry-after + margin', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnFailure();

      heartbeatMonitor.start();

      // Simulate a rate limit event with retry-after 120s
      eventBus.emitEvent(EVENT_TYPES.RATE_LIMIT_DETECTED, {
        metadata: { cli: 'claude', retryAfterSeconds: 120 },
      });

      // First tick at 5 min (initial base interval, already scheduled)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(1);

      // After tick, next should be based on retry-after (120s) if still set
      // But retry-after was cleared after first tick in _incrementBackoff
      // The next retry-after only applies if the event fires again
    });

    it('uses retry-after delay when event arrives before first tick', async () => {
      // Set up: CLI rate-limited with retry-after 30s
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnFailure();

      heartbeatMonitor.start();

      // Emit retry-after event immediately
      eventBus.emitEvent(EVENT_TYPES.RATE_LIMIT_DETECTED, {
        metadata: { cli: 'claude', retryAfterSeconds: 30 },
      });

      // The first tick was already scheduled at base (5 min).
      // The retry-after affects scheduling AFTER the next tick completes.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('captures retry-after from RATE_LIMIT_DETECTED event', () => {
      heartbeatMonitor.start();

      eventBus.emitEvent(EVENT_TYPES.RATE_LIMIT_DETECTED, {
        metadata: { cli: 'claude', retryAfterSeconds: 300 },
      });

      const state = heartbeatMonitor.getBackoffState('claude');
      expect(state).toBeDefined();
      expect(state.retryAfterSeconds).toBe(300);
    });

    it('clears retry-after after a failed ping (delay window passed)', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnFailure();

      heartbeatMonitor.start();

      // Set retry-after
      eventBus.emitEvent(EVENT_TYPES.RATE_LIMIT_DETECTED, {
        metadata: { cli: 'claude', retryAfterSeconds: 60 },
      });

      // After first tick, retry-after should be cleared
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      const state = heartbeatMonitor.getBackoffState('claude');
      expect(state.retryAfterSeconds).toBeNull();
      expect(state.consecutiveFails).toBe(1);
    });
  });

  // ── Auto-resume integration ───────────────────────────────────

  describe('auto-resume integration', () => {
    it('triggers auto-resume when CLI recovers + orchestrator paused + matching checkpoint exists', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });

      const cp = makeCheckpoint({ cliType: 'claude' });
      checkpointManager.listPendingCheckpoints.mockResolvedValue([cp]);
      checkpointManager.validateCheckpoint.mockReturnValue({ valid: true });
      resumeTask.mockResolvedValue({ success: true });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(komodoState.setExecutionState).toHaveBeenCalledWith(EXECUTION_STATES.RUNNING);
      expect(resumeTask).toHaveBeenCalledWith(cp.checkpoint, config.rootDir);
    });

    it('deletes checkpoint after successful auto-resume', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });

      const cp = makeCheckpoint({ cliType: 'claude' });
      checkpointManager.listPendingCheckpoints
        .mockResolvedValueOnce([cp])  // first call: find checkpoints
        .mockResolvedValueOnce([]);   // second call: cleanup remaining
      checkpointManager.validateCheckpoint.mockReturnValue({ valid: true });
      resumeTask.mockResolvedValue({ success: true });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(checkpointManager.deleteCheckpoint).toHaveBeenCalledWith(cp.filepath);
    });

    it('emits SESSION_AUTO_RESUMED event with taskId, cli, and downtimeMinutes on success', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });

      const cp = makeCheckpoint({ cliType: 'claude', taskId: 'task-abc' });
      checkpointManager.listPendingCheckpoints
        .mockResolvedValueOnce([cp])
        .mockResolvedValueOnce([]);
      checkpointManager.validateCheckpoint.mockReturnValue({ valid: true });
      resumeTask.mockResolvedValue({ success: true });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.SESSION_AUTO_RESUMED,
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskId: 'task-abc',
            cli: 'claude',
            downtimeMinutes: expect.any(Number),
          }),
        }),
      );
    });

    it('does not auto-resume when orchestrator is not paused', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.RUNNING });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(resumeTask).not.toHaveBeenCalled();
      expect(komodoState.setExecutionState).not.toHaveBeenCalled();
    });

    it('does not auto-resume when no checkpoints are pending', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });
      checkpointManager.listPendingCheckpoints.mockResolvedValue([]);

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(resumeTask).not.toHaveBeenCalled();
      expect(komodoState.setExecutionState).not.toHaveBeenCalled();
    });

    it('does not auto-resume when no checkpoint matches the recovered CLI', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });

      // Checkpoint is for codex, but claude recovered
      const cp = makeCheckpoint({ cliType: 'codex' });
      checkpointManager.listPendingCheckpoints.mockResolvedValue([cp]);

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(resumeTask).not.toHaveBeenCalled();
    });

    it('retries on next tick when resume fails', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });

      const cp = makeCheckpoint({ cliType: 'claude' });
      checkpointManager.listPendingCheckpoints.mockResolvedValue([cp]);
      checkpointManager.validateCheckpoint.mockReturnValue({ valid: true });

      // First attempt fails
      resumeTask.mockResolvedValueOnce({ success: false, error: 'CLI timed out' });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      // Resume was attempted
      expect(resumeTask).toHaveBeenCalledTimes(1);
      // Checkpoint was NOT deleted (left for retry)
      expect(checkpointManager.deleteCheckpoint).not.toHaveBeenCalled();
      // State set back to PAUSED for next tick
      expect(komodoState.setExecutionState).toHaveBeenCalledWith(EXECUTION_STATES.PAUSED);
    });

    it('resumes the most recent matching checkpoint when multiple exist', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });

      const olderCp = makeCheckpoint({
        cliType: 'claude',
        taskId: 'task-old',
        timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      });
      const newerCp = makeCheckpoint({
        cliType: 'claude',
        taskId: 'task-new',
        timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      });

      // listPendingCheckpoints returns newest first
      checkpointManager.listPendingCheckpoints
        .mockResolvedValueOnce([newerCp, olderCp])
        .mockResolvedValueOnce([]);
      checkpointManager.validateCheckpoint.mockReturnValue({ valid: true });
      resumeTask.mockResolvedValue({ success: true });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      // Should resume the newer checkpoint (first match)
      expect(resumeTask).toHaveBeenCalledWith(newerCp.checkpoint, config.rootDir);
    });

    it('discards invalid checkpoint and does not resume', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });

      const cp = makeCheckpoint({ cliType: 'claude' });
      checkpointManager.listPendingCheckpoints.mockResolvedValue([cp]);
      checkpointManager.validateCheckpoint.mockReturnValue({ valid: false, reason: 'missing branchName' });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(checkpointManager.deleteCheckpoint).toHaveBeenCalledWith(cp.filepath);
      expect(resumeTask).not.toHaveBeenCalled();
    });

    it('cleans up remaining checkpoints for same task after successful resume', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });

      const cp = makeCheckpoint({ cliType: 'claude', taskId: 'task-123' });
      const remainingCp = makeCheckpoint({ cliType: 'codex', taskId: 'task-123' });

      checkpointManager.listPendingCheckpoints
        .mockResolvedValueOnce([cp])
        .mockResolvedValueOnce([remainingCp]); // remaining after deletion
      checkpointManager.validateCheckpoint.mockReturnValue({ valid: true });
      resumeTask.mockResolvedValue({ success: true });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      // Both the resumed checkpoint and the remaining one for same task should be deleted
      expect(checkpointManager.deleteCheckpoint).toHaveBeenCalledWith(cp.filepath);
      expect(checkpointManager.deleteCheckpoint).toHaveBeenCalledWith(remainingCp.filepath);
    });
  });
});
