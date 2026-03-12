import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    SELF_HEALING_OFFLINE_MODE: 'self-healing:offline-mode',
    SELF_HEALING_SYNC_COMPLETED: 'self-healing:sync-completed',
  },
}));
vi.mock('../offline-queue.js', () => {
  const queue = [];
  return {
    offlineQueue: {
      get size() { return queue.length; },
      enqueue: vi.fn((op) => { queue.push(op); return 'op-1'; }),
      drain: vi.fn(async (fn) => {
        let processed = 0, failed = 0;
        for (const item of [...queue]) {
          try { await fn(item); queue.splice(queue.indexOf(item), 1); processed++; }
          catch { failed++; }
        }
        return { processed, failed };
      }),
      _clear: () => { queue.length = 0; },
    },
  };
});

import { firebaseDownStrategy } from './firebase-down.js';
import { offlineQueue } from '../offline-queue.js';

beforeEach(() => {
  vi.clearAllMocks();
  offlineQueue._clear();
  firebaseDownStrategy._syncInterval = null;
});

afterEach(() => {
  if (firebaseDownStrategy._syncInterval) {
    clearInterval(firebaseDownStrategy._syncInterval);
    firebaseDownStrategy._syncInterval = null;
  }
});

describe('firebaseDownStrategy', () => {
  describe('detect()', () => {
    it('returns true for Firebase error messages', () => {
      expect(firebaseDownStrategy.detect({ errorMessage: 'Could not reach Cloud Firestore' })).toBe(true);
      expect(firebaseDownStrategy.detect({ errorMessage: 'UNAVAILABLE: service not available' })).toBe(true);
      expect(firebaseDownStrategy.detect({ errorMessage: 'WebChannel transport errored' })).toBe(true);
    });

    it('returns false for non-Firebase errors', () => {
      expect(firebaseDownStrategy.detect({ errorMessage: 'TypeError: undefined is not a function' })).toBe(false);
    });

    it('returns false for empty/missing errorMessage', () => {
      expect(firebaseDownStrategy.detect({ errorMessage: '' })).toBe(false);
      expect(firebaseDownStrategy.detect({})).toBe(false);
    });
  });

  describe('heal()', () => {
    it('enqueues operation and returns healed:true', async () => {
      const result = await firebaseDownStrategy.heal({
        errorMessage: 'UNAVAILABLE',
        operation: { collection: 'tasks', docId: '1', data: {} },
      });
      expect(result.healed).toBe(true);
      expect(result.action).toBe('offline-mode');
      expect(offlineQueue.enqueue).toHaveBeenCalledWith({ collection: 'tasks', docId: '1', data: {} });
    });

    it('returns healed:false when operation is undefined', async () => {
      const result = await firebaseDownStrategy.heal({
        errorMessage: 'UNAVAILABLE',
      });
      expect(result.healed).toBe(false);
      expect(result.action).toBe('no-operation');
    });

    it('schedules sync when firebaseFn is provided', async () => {
      const fn = vi.fn();
      await firebaseDownStrategy.heal({
        errorMessage: 'UNAVAILABLE',
        operation: { collection: 'tasks', docId: '1', data: {} },
        firebaseFn: fn,
      });
      expect(firebaseDownStrategy._syncInterval).not.toBeNull();
    });

    it('does not schedule duplicate sync intervals', async () => {
      const fn = vi.fn();
      await firebaseDownStrategy.heal({
        errorMessage: 'UNAVAILABLE',
        operation: { collection: 'tasks', docId: '1', data: {} },
        firebaseFn: fn,
      });
      const firstInterval = firebaseDownStrategy._syncInterval;
      await firebaseDownStrategy.heal({
        errorMessage: 'UNAVAILABLE',
        operation: { collection: 'tasks', docId: '2', data: {} },
        firebaseFn: fn,
      });
      expect(firebaseDownStrategy._syncInterval).toBe(firstInterval);
    });
  });

  describe('scheduleSync()', () => {
    it('clears interval when queue is empty', async () => {
      vi.useFakeTimers();
      offlineQueue.drain.mockResolvedValueOnce({ processed: 0, failed: 0 });
      // size returns 0 by default since queue is empty
      firebaseDownStrategy.scheduleSync(vi.fn());
      expect(firebaseDownStrategy._syncInterval).not.toBeNull();
      vi.advanceTimersByTime(30_000);
      await vi.runAllTimersAsync();
      // Interval should be cleared because queue was empty
      expect(firebaseDownStrategy._syncInterval).toBeNull();
      vi.useRealTimers();
    });
  });
});
