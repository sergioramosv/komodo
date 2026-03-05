import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks ---

const { mockLogger, mockEventBus, mockKomodoState, mockCheckpointManager, mockConfig } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  mockEventBus: { emitEvent: vi.fn() },
  mockKomodoState: {
    phase: 'idle',
    executionState: 'running',
    currentTask: null,
    getSnapshot: vi.fn(() => ({
      phase: 'idle',
      currentTask: null,
      taskDetails: null,
      currentPR: null,
      reviewCycle: 0,
    })),
    setExecutionState: vi.fn(),
  },
  mockCheckpointManager: {
    stop: vi.fn(),
    _flowContext: {},
  },
  mockConfig: { rootDir: '/tmp/test-komodo' },
}));

vi.mock('../utils/logger.js', () => ({ logger: mockLogger }));
vi.mock('../events/event-bus.js', () => ({
  eventBus: mockEventBus,
  EVENT_TYPES: {
    SHUTDOWN_STARTED: 'shutdown:started',
    SHUTDOWN_COMPLETE: 'shutdown:complete',
    SESSION_CHECKPOINTED: 'session:checkpointed',
    EXECUTION_STATE_CHANGE: 'execution:state-change',
  },
}));
vi.mock('../state/komodo-state.js', () => ({
  komodoState: mockKomodoState,
  EXECUTION_STATES: {
    STOPPED: 'stopped',
    RUNNING: 'running',
    PAUSED: 'paused',
  },
}));
vi.mock('../state/checkpoint-manager.js', () => ({
  checkpointManager: mockCheckpointManager,
}));
vi.mock('../config.js', () => ({ config: mockConfig }));

// Mock fs/promises to avoid real file writes
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { ShutdownManager, DEFAULT_SHUTDOWN_TIMEOUT_MS } = await import('./shutdown-manager.js');

// --- Tests ---

describe('ShutdownManager', () => {
  /** @type {ShutdownManager} */
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ShutdownManager();

    // Reset mock state
    mockKomodoState.phase = 'idle';
    mockKomodoState.executionState = 'running';
    mockKomodoState.currentTask = null;
    mockCheckpointManager._flowContext = {};
  });

  afterEach(() => {
    manager.unregister();
  });

  describe('register()', () => {
    it('registers signal handlers', () => {
      const onSpy = vi.spyOn(process, 'on');

      manager.register();

      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

      onSpy.mockRestore();
    });

    it('does not register twice', () => {
      const onSpy = vi.spyOn(process, 'on');

      manager.register();
      manager.register();

      // Should only have 2 calls (SIGINT + SIGTERM), not 4
      const sigCalls = onSpy.mock.calls.filter(
        ([event]) => event === 'SIGINT' || event === 'SIGTERM'
      );
      expect(sigCalls.length).toBe(2);

      onSpy.mockRestore();
    });

    it('stores wsServer reference', () => {
      const mockWsServer = { stop: vi.fn().mockResolvedValue(undefined) };
      manager.register({ wsServer: mockWsServer });

      expect(manager._wsServer).toBe(mockWsServer);
    });

    it('accepts custom timeout', () => {
      manager.register({ timeoutMs: 5000 });
      expect(manager._timeoutMs).toBe(5000);
    });
  });

  describe('unregister()', () => {
    it('removes signal handlers', () => {
      const removeSpy = vi.spyOn(process, 'removeListener');

      manager.register();
      manager.unregister();

      expect(removeSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

      removeSpy.mockRestore();
    });

    it('resets internal state', () => {
      const mockWsServer = { stop: vi.fn().mockResolvedValue(undefined) };
      manager.register({ wsServer: mockWsServer });

      manager.unregister();

      expect(manager._registered).toBe(false);
      expect(manager._wsServer).toBeNull();
      expect(manager._shuttingDown).toBe(false);
    });

    it('is safe to call without register', () => {
      expect(() => manager.unregister()).not.toThrow();
    });
  });

  describe('_performShutdown()', () => {
    it('sets execution state to stopped', async () => {
      await manager._performShutdown();

      expect(mockKomodoState.setExecutionState).toHaveBeenCalledWith('stopped');
    });

    it('stops checkpoint manager', async () => {
      await manager._performShutdown();

      expect(mockCheckpointManager.stop).toHaveBeenCalled();
    });

    it('stops WebSocket server when available', async () => {
      const mockWsServer = { stop: vi.fn().mockResolvedValue(undefined) };
      manager._wsServer = mockWsServer;

      await manager._performShutdown();

      expect(mockWsServer.stop).toHaveBeenCalled();
      expect(manager._wsServer).toBeNull();
    });

    it('handles shutdown without WS server', async () => {
      manager._wsServer = null;

      await expect(manager._performShutdown()).resolves.not.toThrow();
    });

    it('saves checkpoint when task is in progress', async () => {
      const { writeFile } = await import('fs/promises');

      mockKomodoState.getSnapshot.mockReturnValue({
        phase: 'coding',
        currentTask: 'task-123',
        taskDetails: { title: 'Test task' },
        currentPR: 42,
        reviewCycle: 0,
      });
      mockCheckpointManager._flowContext = {
        branchName: 'feature/test',
        repoUrl: 'https://github.com/test/repo',
      };

      await manager._performShutdown();

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('checkpoint-task-123'),
        expect.stringContaining('"reason": "graceful-shutdown"'),
        'utf-8',
      );
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'session:checkpointed',
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'graceful-shutdown' }),
        }),
      );
    });

    it('does not save checkpoint when no task is active', async () => {
      const { writeFile } = await import('fs/promises');

      mockKomodoState.getSnapshot.mockReturnValue({
        phase: 'idle',
        currentTask: null,
        taskDetails: null,
        currentPR: null,
        reviewCycle: 0,
      });

      await manager._performShutdown();

      expect(writeFile).not.toHaveBeenCalled();
    });
  });

  describe('_waitForIdle()', () => {
    it('resolves immediately if already idle', async () => {
      mockKomodoState.phase = 'idle';

      const result = await manager._waitForIdle(1000);

      expect(result).toBe(true);
    });

    it('returns false on timeout', async () => {
      mockKomodoState.phase = 'coding';

      const result = await manager._waitForIdle(600);

      expect(result).toBe(false);
    });

    it('resolves true when phase becomes idle before timeout', async () => {
      mockKomodoState.phase = 'coding';

      // Simulate phase becoming idle after 300ms
      setTimeout(() => {
        mockKomodoState.phase = 'idle';
      }, 300);

      const result = await manager._waitForIdle(2000);

      expect(result).toBe(true);
    });
  });

  describe('_onSignal()', () => {
    it('prevents double shutdown on second signal', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

      manager._shuttingDown = true;

      await manager._onSignal('SIGINT');

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Forced shutdown'),
        'SHUTDOWN',
      );

      exitSpy.mockRestore();
    });

    it('emits shutdown events', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

      await manager._onSignal('SIGTERM');

      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'shutdown:started',
        expect.objectContaining({
          metadata: expect.objectContaining({ signal: 'SIGTERM' }),
        }),
      );
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'shutdown:complete',
        expect.objectContaining({
          metadata: expect.objectContaining({ signal: 'SIGTERM' }),
        }),
      );

      exitSpy.mockRestore();
    });

    it('calls process.exit(0) on successful shutdown', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

      await manager._onSignal('SIGINT');

      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
    });
  });

  describe('isShuttingDown', () => {
    it('returns false initially', () => {
      expect(manager.isShuttingDown).toBe(false);
    });

    it('returns true after signal received', () => {
      manager._shuttingDown = true;
      expect(manager.isShuttingDown).toBe(true);
    });
  });

  describe('DEFAULT_SHUTDOWN_TIMEOUT_MS', () => {
    it('is 30 seconds', () => {
      expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(30_000);
    });
  });
});
