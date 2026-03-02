import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { basename } from 'path';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue('{}'),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Mock event bus
vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    on: vi.fn().mockReturnValue(vi.fn()),
    emitEvent: vi.fn(),
  },
  EVENT_TYPES: {
    RATE_LIMIT_DETECTED: 'agent:rate-limit',
    SESSION_CHECKPOINTED: 'session:checkpointed',
    EXECUTION_STATE_CHANGE: 'execution:state-change',
  },
}));

// Mock komodo state
vi.mock('./komodo-state.js', () => ({
  komodoState: {
    getSnapshot: vi.fn().mockReturnValue({
      phase: 'coding',
      currentTask: 'task-123',
      taskDetails: { title: 'Test Task' },
      currentPR: 42,
      reviewCycle: 0,
      executionState: 'running',
    }),
    setExecutionState: vi.fn(),
  },
  EXECUTION_STATES: {
    STOPPED: 'stopped',
    RUNNING: 'running',
    PAUSED: 'paused',
  },
}));

// Mock config
vi.mock('../config.js', () => ({
  config: {
    rootDir: '/test/root',
  },
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { mkdir, writeFile, readdir, readFile, unlink } from 'fs/promises';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState } from './komodo-state.js';
import { logger } from '../utils/logger.js';
import { checkpointManager } from './checkpoint-manager.js';

describe('CheckpointManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T12:00:00.000Z'));

    // Reset singleton state
    checkpointManager.stop();
    checkpointManager.clearFlowContext();

    // Re-setup default mock return for on()
    eventBus.on.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    checkpointManager.stop();
    vi.useRealTimers();
  });

  /**
   * Helper: starts the checkpoint manager and returns the
   * RATE_LIMIT_DETECTED handler registered with eventBus.on.
   */
  function startAndGetHandler() {
    checkpointManager.start();
    return eventBus.on.mock.calls[0][1];
  }

  describe('start', () => {
    it('subscribes to RATE_LIMIT_DETECTED event', () => {
      checkpointManager.start();
      expect(eventBus.on).toHaveBeenCalledWith(
        EVENT_TYPES.RATE_LIMIT_DETECTED,
        expect.any(Function),
      );
    });

    it('does not subscribe twice if called again', () => {
      checkpointManager.start();
      checkpointManager.start();
      expect(eventBus.on).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('calls unsubscribe function', () => {
      const unsubscribe = vi.fn();
      eventBus.on.mockReturnValueOnce(unsubscribe);

      checkpointManager.start();
      checkpointManager.stop();

      expect(unsubscribe).toHaveBeenCalled();
    });

    it('allows start to be called again after stop', () => {
      checkpointManager.start();
      checkpointManager.stop();
      checkpointManager.start();
      expect(eventBus.on).toHaveBeenCalledTimes(2);
    });
  });

  describe('_onRateLimitDetected', () => {
    const defaultPayload = {
      agentName: 'CODER',
      metadata: { cli: 'claude', matchedPattern: '/rate limit/i' },
    };

    it('saves checkpoint with correct structure', async () => {
      checkpointManager.setFlowContext({
        branchName: 'feature/test-branch',
        repoUrl: 'https://github.com/test/repo',
      });

      const handler = startAndGetHandler();
      await handler(defaultPayload);

      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.komodo'),
        { recursive: true },
      );

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/checkpoint-task-123-\d+\.json$/),
        expect.any(String),
        'utf-8',
      );

      const savedJson = JSON.parse(writeFile.mock.calls[0][1]);
      expect(savedJson).toEqual({
        taskId: 'task-123',
        taskTitle: 'Test Task',
        flowStep: 'code',
        branchName: 'feature/test-branch',
        prNumber: 42,
        repoUrl: 'https://github.com/test/repo',
        agentRole: 'CODER',
        cliType: 'claude',
        timestamp: '2026-03-02T12:00:00.000Z',
        reviewRound: null,
        reviewIssues: null,
      });
    });

    it('emits SESSION_CHECKPOINTED event', async () => {
      const handler = startAndGetHandler();
      await handler(defaultPayload);

      expect(eventBus.emitEvent).toHaveBeenCalledWith(EVENT_TYPES.SESSION_CHECKPOINTED, {
        metadata: { path: expect.stringContaining('checkpoint-') },
      });
    });

    it('sets execution state to PAUSED', async () => {
      const handler = startAndGetHandler();
      await handler(defaultPayload);

      expect(komodoState.setExecutionState).toHaveBeenCalledWith('paused');
    });

    it('logs warning messages', async () => {
      const handler = startAndGetHandler();
      await handler(defaultPayload);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit detected'),
        'KOMODO',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Execution paused'),
        'KOMODO',
      );
    });

    it('maps review phase with fix flowStep override', async () => {
      komodoState.getSnapshot.mockReturnValue({
        phase: 'reviewing',
        currentTask: 'task-456',
        taskDetails: { title: 'Review Task' },
        currentPR: 10,
        reviewCycle: 2,
        executionState: 'running',
      });

      checkpointManager.setFlowContext({
        flowStep: 'fix',
        reviewIssues: [{ severity: 'high', message: 'Missing null check' }],
        branchName: 'feature/fix-branch',
        repoUrl: 'https://github.com/test/repo',
      });

      const handler = startAndGetHandler();
      await handler({
        agentName: 'CODER',
        metadata: { cli: 'codex' },
      });

      const savedJson = JSON.parse(writeFile.mock.calls[0][1]);
      expect(savedJson.flowStep).toBe('fix');
      expect(savedJson.reviewRound).toBe(2);
      expect(savedJson.reviewIssues).toEqual([
        { severity: 'high', message: 'Missing null check' },
      ]);
      expect(savedJson.cliType).toBe('codex');
    });

    it('uses phase mapping when no flowStep override', async () => {
      komodoState.getSnapshot.mockReturnValue({
        phase: 'planning',
        currentTask: 'task-789',
        taskDetails: { title: 'Plan Task' },
        currentPR: null,
        reviewCycle: 0,
        executionState: 'running',
      });

      const handler = startAndGetHandler();
      await handler({
        agentName: 'PLANNER',
        metadata: { cli: 'gemini' },
      });

      const savedJson = JSON.parse(writeFile.mock.calls[0][1]);
      expect(savedJson.flowStep).toBe('plan');
      expect(savedJson.agentRole).toBe('PLANNER');
    });

    it('handles mkdir errors gracefully', async () => {
      mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const handler = startAndGetHandler();
      await handler(defaultPayload);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save checkpoint'),
        'KOMODO',
      );
      // Should not throw — error is caught internally
    });

    it('handles writeFile errors gracefully', async () => {
      writeFile.mockRejectedValueOnce(new Error('No space left on device'));

      const handler = startAndGetHandler();
      await handler(defaultPayload);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save checkpoint'),
        'KOMODO',
      );
      // mkdir succeeded but writeFile failed — should not throw
      expect(mkdir).toHaveBeenCalled();
      expect(komodoState.setExecutionState).not.toHaveBeenCalled();
    });

    it('sanitizes taskId in filename', async () => {
      komodoState.getSnapshot.mockReturnValue({
        phase: 'coding',
        currentTask: '-OmiYz/weird:id',
        taskDetails: { title: 'Weird ID Task' },
        currentPR: null,
        reviewCycle: 0,
        executionState: 'running',
      });

      const handler = startAndGetHandler();
      await handler({
        agentName: 'PLANNER',
        metadata: { cli: 'gemini' },
      });

      const filepath = writeFile.mock.calls[0][0];
      const filename = basename(filepath);
      // Filename should not contain / or : (only the filename part)
      expect(filename).not.toMatch(/[/:]/);
      expect(filename).toMatch(/^checkpoint--OmiYz_weird_id-\d+\.json$/);
    });

    it('uses "unknown" when taskId is null', async () => {
      komodoState.getSnapshot.mockReturnValue({
        phase: 'idle',
        currentTask: null,
        taskDetails: null,
        currentPR: null,
        reviewCycle: 0,
        executionState: 'running',
      });

      const handler = startAndGetHandler();
      await handler(defaultPayload);

      const filepath = writeFile.mock.calls[0][0];
      const filename = basename(filepath);
      expect(filename).toMatch(/^checkpoint-unknown-\d+\.json$/);
    });
  });

  describe('validateCheckpoint', () => {
    it('returns valid for a complete checkpoint', () => {
      const result = checkpointManager.validateCheckpoint({
        taskId: 'task-1',
        flowStep: 'review',
        prNumber: 42,
        branchName: 'feature/test',
      });
      expect(result).toEqual({ valid: true });
    });

    it('rejects null checkpoint', () => {
      const result = checkpointManager.validateCheckpoint(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('taskId');
    });

    it('rejects checkpoint without taskId', () => {
      const result = checkpointManager.validateCheckpoint({ flowStep: 'code' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('taskId');
    });

    it('rejects checkpoint without flowStep', () => {
      const result = checkpointManager.validateCheckpoint({ taskId: 'task-1' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('flowStep');
    });

    it('rejects review step without prNumber', () => {
      const result = checkpointManager.validateCheckpoint({
        taskId: 'task-1',
        flowStep: 'review',
        branchName: 'feature/test',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('prNumber');
    });

    it('rejects fix step without prNumber', () => {
      const result = checkpointManager.validateCheckpoint({
        taskId: 'task-1',
        flowStep: 'fix',
        branchName: 'feature/test',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('prNumber');
    });

    it('rejects merge step without prNumber', () => {
      const result = checkpointManager.validateCheckpoint({
        taskId: 'task-1',
        flowStep: 'merge',
        branchName: 'feature/test',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('prNumber');
    });

    it('rejects analyze step without prNumber', () => {
      const result = checkpointManager.validateCheckpoint({
        taskId: 'task-1',
        flowStep: 'analyze',
        branchName: 'feature/test',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('prNumber');
    });

    it('rejects code step without branchName', () => {
      const result = checkpointManager.validateCheckpoint({
        taskId: 'task-1',
        flowStep: 'code',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('branchName');
    });

    it('rejects analyze step without branchName', () => {
      const result = checkpointManager.validateCheckpoint({
        taskId: 'task-1',
        flowStep: 'analyze',
        prNumber: 42,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('branchName');
    });

    it('accepts plan step without prNumber or branchName', () => {
      const result = checkpointManager.validateCheckpoint({
        taskId: 'task-1',
        flowStep: 'plan',
      });
      expect(result).toEqual({ valid: true });
    });
  });

  describe('listPendingCheckpoints', () => {
    it('returns empty array when checkpoint directory does not exist', async () => {
      readdir.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await checkpointManager.listPendingCheckpoints();
      expect(result).toEqual([]);
    });

    it('returns empty array when no checkpoint files exist', async () => {
      readdir.mockResolvedValueOnce(['other-file.txt', 'readme.md']);
      const result = await checkpointManager.listPendingCheckpoints();
      expect(result).toEqual([]);
    });

    it('returns parsed checkpoints sorted by timestamp (newest first)', async () => {
      const older = { taskId: 'task-1', timestamp: '2026-03-01T10:00:00.000Z' };
      const newer = { taskId: 'task-2', timestamp: '2026-03-02T10:00:00.000Z' };

      readdir.mockResolvedValueOnce([
        'checkpoint-task-1-1000.json',
        'checkpoint-task-2-2000.json',
      ]);
      readFile
        .mockResolvedValueOnce(JSON.stringify(older))
        .mockResolvedValueOnce(JSON.stringify(newer));

      const result = await checkpointManager.listPendingCheckpoints();

      expect(result).toHaveLength(2);
      expect(result[0].checkpoint.taskId).toBe('task-2');
      expect(result[1].checkpoint.taskId).toBe('task-1');
    });

    it('discards corrupted checkpoint files', async () => {
      readdir.mockResolvedValueOnce(['checkpoint-bad-1000.json']);
      readFile.mockRejectedValueOnce(new Error('invalid json'));

      const result = await checkpointManager.listPendingCheckpoints();

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('corrupto'),
        'KOMODO',
      );
      expect(unlink).toHaveBeenCalled();
    });
  });

  describe('deleteCheckpoint', () => {
    it('deletes the checkpoint file', async () => {
      await checkpointManager.deleteCheckpoint('/path/to/checkpoint.json');
      expect(unlink).toHaveBeenCalledWith('/path/to/checkpoint.json');
    });

    it('does not throw if file already deleted', async () => {
      unlink.mockRejectedValueOnce(new Error('ENOENT'));
      await expect(
        checkpointManager.deleteCheckpoint('/path/to/checkpoint.json'),
      ).resolves.toBeUndefined();
    });
  });
});
