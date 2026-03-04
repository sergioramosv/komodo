import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  config: {
    heartbeatEnabled: true,
    heartbeatIntervalMinutes: 5,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn(() => ({})) },
  EVENT_TYPES: {
    CLI_RECOVERED: 'cli:recovered',
  },
}));

vi.mock('../agents/fallback-manager.js', () => ({
  fallbackManager: {
    getRateLimitedClis: vi.fn(() => []),
    markRecovered: vi.fn(() => true),
  },
}));

vi.mock('../state/checkpoint-manager.js', () => ({
  checkpointManager: {
    listPendingCheckpoints: vi.fn(async () => []),
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
    it('starts the interval when enabled', () => {
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

    it('stop() clears the interval', () => {
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

  // ── Auto-resume integration ───────────────────────────────────

  describe('auto-resume integration', () => {
    it('triggers auto-resume when CLI recovers + orchestrator paused + checkpoint exists', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });
      checkpointManager.listPendingCheckpoints.mockResolvedValue([
        { filepath: '/tmp/checkpoint-1.json', checkpoint: {} },
      ]);

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(komodoState.setExecutionState).toHaveBeenCalledWith(EXECUTION_STATES.RUNNING);
    });

    it('does not auto-resume when orchestrator is not paused', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.RUNNING });

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(komodoState.setExecutionState).not.toHaveBeenCalled();
    });

    it('does not auto-resume when no checkpoints are pending', async () => {
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      komodoState.getSnapshot.mockReturnValue({ executionState: EXECUTION_STATES.PAUSED });
      checkpointManager.listPendingCheckpoints.mockResolvedValue([]);

      heartbeatMonitor.start();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(komodoState.setExecutionState).not.toHaveBeenCalled();
    });
  });

  // ── Configurable interval ─────────────────────────────────────

  describe('configurable interval', () => {
    it('uses HEARTBEAT_INTERVAL_MINUTES from config', async () => {
      config.heartbeatIntervalMinutes = 2;
      fallbackManager.getRateLimitedClis.mockReturnValue(['claude']);
      simulateSpawnSuccess();

      heartbeatMonitor.start();

      // Should NOT have ticked yet at 1 minute
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
      expect(spawn).not.toHaveBeenCalled();

      // Should tick at 2 minutes
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
      expect(spawn).toHaveBeenCalled();
    });
  });
});
