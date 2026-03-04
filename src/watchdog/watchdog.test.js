import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig, mockLogger, mockEventBus } = vi.hoisted(() => ({
  mockConfig: { agentTimeoutMinutes: 15 },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  mockEventBus: { emitEvent: vi.fn() },
}));

vi.mock('../config.js', () => ({ config: mockConfig }));
vi.mock('../utils/logger.js', () => ({ logger: mockLogger }));
vi.mock('../events/event-bus.js', () => ({
  eventBus: mockEventBus,
  EVENT_TYPES: {
    WATCHDOG_KILL: 'watchdog:kill',
    WATCHDOG_RETRY: 'watchdog:retry',
    WATCHDOG_EXHAUSTED: 'watchdog:exhausted',
  },
}));

const { withWatchdog, _isTimeoutError, _getTimeoutMs } = await import('./watchdog.js');

// --- Tests ---

describe('watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.agentTimeoutMinutes = 15;
  });

  describe('withWatchdog()', () => {
    it('returns result immediately on success', async () => {
      const agentFn = vi.fn().mockResolvedValue({ success: true, result: { done: true } });

      const result = await withWatchdog(agentFn, { agentName: 'CODER' });

      expect(result).toEqual({ success: true, result: { done: true } });
      expect(agentFn).toHaveBeenCalledTimes(1);
      expect(mockEventBus.emitEvent).not.toHaveBeenCalled();
    });

    it('returns result on non-timeout failure (no retry)', async () => {
      const agentFn = vi.fn().mockResolvedValue({
        success: false,
        error: 'Syntax error in prompt',
      });

      const result = await withWatchdog(agentFn, { agentName: 'CODER' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Syntax error in prompt');
      expect(agentFn).toHaveBeenCalledTimes(1);
    });

    it('retries on timeout error and succeeds on retry', async () => {
      const agentFn = vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'Idle timeout: claude silent for 900s' })
        .mockResolvedValueOnce({ success: true, result: { pr: 42 } });

      const result = await withWatchdog(agentFn, {
        agentName: 'CODER',
        taskId: 'task-123',
      });

      expect(result).toEqual({ success: true, result: { pr: 42 } });
      expect(agentFn).toHaveBeenCalledTimes(2);

      // Should emit WATCHDOG_KILL for first attempt
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith('watchdog:kill', expect.objectContaining({
        agentName: 'CODER',
        metadata: expect.objectContaining({ taskId: 'task-123', attempt: 0 }),
      }));

      // Should emit WATCHDOG_RETRY for second attempt
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith('watchdog:retry', expect.objectContaining({
        agentName: 'CODER',
        metadata: expect.objectContaining({ attempt: 1, maxRetries: 2 }),
      }));
    });

    it('retries up to maxRetries times then calls onCheckpoint', async () => {
      const agentFn = vi.fn().mockResolvedValue({
        success: false,
        error: 'Idle timeout: claude silent for 900s',
      });
      const onCheckpoint = vi.fn();

      const result = await withWatchdog(agentFn, {
        agentName: 'PLANNER',
        taskId: 'task-456',
        maxRetries: 2,
        onCheckpoint,
      });

      // 1 initial + 2 retries = 3 total calls
      expect(agentFn).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(false);
      expect(onCheckpoint).toHaveBeenCalledTimes(1);

      // Should emit WATCHDOG_EXHAUSTED
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith('watchdog:exhausted', expect.objectContaining({
        agentName: 'PLANNER',
        metadata: expect.objectContaining({ taskId: 'task-456', maxRetries: 2 }),
      }));
    });

    it('handles Total timeout errors the same as Idle timeout', async () => {
      const agentFn = vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'Total timeout: codex exceeded 3600s' })
        .mockResolvedValueOnce({ success: true, result: {} });

      const result = await withWatchdog(agentFn, { agentName: 'CODER' });

      expect(result.success).toBe(true);
      expect(agentFn).toHaveBeenCalledTimes(2);
    });

    it('respects custom maxRetries=0 (no retries)', async () => {
      const agentFn = vi.fn().mockResolvedValue({
        success: false,
        error: 'Idle timeout: claude silent for 900s',
      });
      const onCheckpoint = vi.fn();

      await withWatchdog(agentFn, {
        agentName: 'CODER',
        maxRetries: 0,
        onCheckpoint,
      });

      expect(agentFn).toHaveBeenCalledTimes(1);
      expect(onCheckpoint).toHaveBeenCalledTimes(1);
    });

    it('does not call onCheckpoint if not provided', async () => {
      const agentFn = vi.fn().mockResolvedValue({
        success: false,
        error: 'Idle timeout: claude silent for 900s',
      });

      // Should not throw
      const result = await withWatchdog(agentFn, {
        agentName: 'CODER',
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
    });

    it('timer resets conceptually: second attempt gets fresh timeout', async () => {
      // This tests that each retry is a fresh call (timer resets because
      // spawnCli creates a new idle timer per process)
      const agentFn = vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'Idle timeout: claude silent for 900s' })
        .mockResolvedValueOnce({ success: false, error: 'Idle timeout: claude silent for 900s' })
        .mockResolvedValueOnce({ success: false, error: 'Idle timeout: claude silent for 900s' });

      const onCheckpoint = vi.fn();

      await withWatchdog(agentFn, {
        agentName: 'CODER',
        maxRetries: 2,
        onCheckpoint,
      });

      // All 3 calls were made (1 initial + 2 retries)
      expect(agentFn).toHaveBeenCalledTimes(3);
      expect(onCheckpoint).toHaveBeenCalledTimes(1);
    });

    it('logs kill and retry events', async () => {
      const agentFn = vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'Idle timeout: claude silent for 900s' })
        .mockResolvedValueOnce({ success: true, result: {} });

      await withWatchdog(agentFn, { agentName: 'CODER', taskId: 'task-789' });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('killed'),
        'KOMODO',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('retry 1/2'),
        'KOMODO',
      );
    });
  });

  describe('_isTimeoutError()', () => {
    it('detects idle timeout errors', () => {
      expect(_isTimeoutError('Idle timeout: claude silent for 900s')).toBe(true);
    });

    it('detects total timeout errors', () => {
      expect(_isTimeoutError('Total timeout: codex exceeded 3600s')).toBe(true);
    });

    it('returns false for non-timeout errors', () => {
      expect(_isTimeoutError('Rate limit exceeded')).toBe(false);
      expect(_isTimeoutError('Connection refused')).toBe(false);
      expect(_isTimeoutError(null)).toBe(false);
      expect(_isTimeoutError(undefined)).toBe(false);
      expect(_isTimeoutError('')).toBe(false);
    });
  });

  describe('_getTimeoutMs()', () => {
    it('returns configured timeout in milliseconds', () => {
      mockConfig.agentTimeoutMinutes = 15;
      expect(_getTimeoutMs()).toBe(15 * 60 * 1000);
    });

    it('uses default 15 minutes when config is 0', () => {
      mockConfig.agentTimeoutMinutes = 0;
      expect(_getTimeoutMs()).toBe(15 * 60 * 1000);
    });

    it('respects custom timeout values', () => {
      mockConfig.agentTimeoutMinutes = 30;
      expect(_getTimeoutMs()).toBe(30 * 60 * 1000);
    });
  });
});
