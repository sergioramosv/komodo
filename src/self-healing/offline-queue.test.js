import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('OfflineQueue', () => {
  let queue;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./offline-queue.js');
    queue = Object.create(mod.offlineQueue);
    queue._queue = [];
    queue._loaded = true;
  });

  describe('enqueue', () => {
    it('adds an operation and returns an id', () => {
      const id = queue.enqueue({ collection: 'tasks', type: 'set' });
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^op-/);
      expect(queue.size).toBe(1);
    });

    it('enqueues multiple operations in order', () => {
      queue.enqueue({ type: 'a' });
      queue.enqueue({ type: 'b' });
      expect(queue.size).toBe(2);
      const snap = queue.getSnapshot();
      expect(snap[0].operation.type).toBe('a');
      expect(snap[1].operation.type).toBe('b');
    });
  });

  describe('drain', () => {
    it('processes all operations successfully', async () => {
      queue.enqueue({ type: 'a' });
      queue.enqueue({ type: 'b' });
      const fn = vi.fn().mockResolvedValue(undefined);
      const result = await queue.drain(fn);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(queue.size).toBe(0);
    });

    it('keeps failed operations in queue', async () => {
      queue.enqueue({ type: 'a' });
      queue.enqueue({ type: 'b' });
      const fn = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('offline'));
      const result = await queue.drain(fn);
      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
      expect(queue.size).toBe(1);
    });

    it('returns zeros on empty queue', async () => {
      const fn = vi.fn();
      const result = await queue.drain(fn);
      expect(result).toEqual({ processed: 0, failed: 0 });
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('size', () => {
    it('returns 0 for empty queue', () => {
      expect(queue.size).toBe(0);
    });

    it('reflects enqueued items', () => {
      queue.enqueue({ type: 'x' });
      expect(queue.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('empties the queue', () => {
      queue.enqueue({ type: 'x' });
      queue.clear();
      expect(queue.size).toBe(0);
    });
  });
});
