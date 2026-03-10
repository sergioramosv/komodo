import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../events/event-bus.js', () => {
  const emitEvent = vi.fn(() => ({}));
  return {
    eventBus: { emitEvent },
    EVENT_TYPES: {
      DEAD_LETTER_QUEUED: 'dead-letter:queued',
    },
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../config.js', () => ({
  config: {
    deadLetterMaxRetries: 3,
  },
}));

const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { DeadLetterQueue } = await import('./dead-letter-queue.js');

describe('DeadLetterQueue', () => {
  let dlq;

  beforeEach(() => {
    vi.clearAllMocks();
    dlq = new DeadLetterQueue({ maxRetries: 3 });
  });

  describe('recordFailure', () => {
    it('does not dead-letter on first failures', () => {
      const result = dlq.recordFailure('task-1', 'Login feature', 'timeout');
      expect(result).toBe(false);
      expect(dlq.isDeadLettered('task-1')).toBe(false);
    });

    it('dead-letters after maxRetries failures', () => {
      dlq.recordFailure('task-1', 'Login feature', 'err1');
      dlq.recordFailure('task-1', 'Login feature', 'err2');
      const result = dlq.recordFailure('task-1', 'Login feature', 'err3');
      expect(result).toBe(true);
      expect(dlq.isDeadLettered('task-1')).toBe(true);
    });

    it('emits dead-letter:queued event', () => {
      for (let i = 0; i < 3; i++) dlq.recordFailure('task-1', 'Login', `err${i}`);
      expect(eventBus.emitEvent).toHaveBeenCalledWith(EVENT_TYPES.DEAD_LETTER_QUEUED, {
        metadata: {
          taskId: 'task-1',
          title: 'Login',
          failureCount: 3,
          error: 'err2',
        },
      });
    });

    it('does not emit duplicate events for same task', () => {
      for (let i = 0; i < 5; i++) dlq.recordFailure('task-1', 'Login', `err${i}`);
      expect(eventBus.emitEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFailureCount', () => {
    it('returns 0 for unknown tasks', () => {
      expect(dlq.getFailureCount('unknown')).toBe(0);
    });

    it('tracks failure count accurately', () => {
      dlq.recordFailure('task-1', 'Test', 'err');
      dlq.recordFailure('task-1', 'Test', 'err');
      expect(dlq.getFailureCount('task-1')).toBe(2);
    });
  });

  describe('getAll', () => {
    it('returns all dead-lettered tasks', () => {
      for (let i = 0; i < 3; i++) dlq.recordFailure('task-1', 'Task 1', 'err');
      for (let i = 0; i < 3; i++) dlq.recordFailure('task-2', 'Task 2', 'err');

      const all = dlq.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].status).toBe('pending-review');
      expect(all[1].status).toBe('pending-review');
    });
  });

  describe('remove', () => {
    it('removes a task from the DLQ', () => {
      for (let i = 0; i < 3; i++) dlq.recordFailure('task-1', 'Test', 'err');
      expect(dlq.isDeadLettered('task-1')).toBe(true);

      dlq.remove('task-1');
      expect(dlq.isDeadLettered('task-1')).toBe(false);
      expect(dlq.getFailureCount('task-1')).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      for (let i = 0; i < 3; i++) dlq.recordFailure('task-1', 'Test', 'err');
      dlq.reset();
      expect(dlq.getAll()).toHaveLength(0);
      expect(dlq.getFailureCount('task-1')).toBe(0);
    });
  });

  describe('getSnapshot', () => {
    it('returns count and tasks', () => {
      for (let i = 0; i < 3; i++) dlq.recordFailure('task-1', 'Test', 'err');
      const snap = dlq.getSnapshot();
      expect(snap.count).toBe(1);
      expect(snap.tasks).toHaveLength(1);
    });
  });
});
