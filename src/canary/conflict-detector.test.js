import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    CANARY_PARALLEL_CONFLICT: 'canary:parallel-conflict',
  },
}));

const { eventBus } = await import('../events/event-bus.js');
const {
  registerActiveTaskFiles,
  unregisterActiveTaskFiles,
  detectParallelConflicts,
} = await import('./conflict-detector.js');

describe('conflict-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up state between tests by unregistering any leftover tasks
    unregisterActiveTaskFiles('task-A');
    unregisterActiveTaskFiles('task-B');
    unregisterActiveTaskFiles('task-C');
  });

  describe('registerActiveTaskFiles', () => {
    it('registers files for a task', () => {
      registerActiveTaskFiles('task-A', ['src/foo.js', 'src/bar.js']);
      const { conflicts } = detectParallelConflicts('task-X', ['src/foo.js']);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].conflictingTaskId).toBe('task-A');
      expect(conflicts[0].files).toEqual(['src/foo.js']);

      unregisterActiveTaskFiles('task-A');
    });

    it('ignores invalid inputs — null taskId', () => {
      expect(() => registerActiveTaskFiles(null, ['src/foo.js'])).not.toThrow();
    });

    it('ignores invalid inputs — empty filesChanged', () => {
      expect(() => registerActiveTaskFiles('task-A', [])).not.toThrow();
    });

    it('ignores invalid inputs — non-array filesChanged', () => {
      expect(() => registerActiveTaskFiles('task-A', null)).not.toThrow();
    });
  });

  describe('unregisterActiveTaskFiles', () => {
    it('removes a task from the active registry', () => {
      registerActiveTaskFiles('task-A', ['src/shared.js']);
      unregisterActiveTaskFiles('task-A');

      // After unregister, no conflict should be found
      const { conflicts } = detectParallelConflicts('task-B', ['src/shared.js']);
      expect(conflicts).toHaveLength(0);
    });

    it('handles unregistering a non-existent task gracefully', () => {
      expect(() => unregisterActiveTaskFiles('task-nonexistent')).not.toThrow();
    });

    it('ignores null taskId', () => {
      expect(() => unregisterActiveTaskFiles(null)).not.toThrow();
    });
  });

  describe('detectParallelConflicts', () => {
    it('returns empty conflicts when no other tasks are active', () => {
      const { conflicts } = detectParallelConflicts('task-A', ['src/foo.js']);
      expect(conflicts).toHaveLength(0);
    });

    it('detects conflict when two tasks modify the same file', () => {
      registerActiveTaskFiles('task-A', ['src/shared.js', 'src/utils.js']);

      const { conflicts } = detectParallelConflicts('task-B', ['src/shared.js']);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].conflictingTaskId).toBe('task-A');
      expect(conflicts[0].files).toEqual(['src/shared.js']);
    });

    it('detects multiple conflicting files', () => {
      registerActiveTaskFiles('task-A', ['src/a.js', 'src/b.js', 'src/c.js']);

      const { conflicts } = detectParallelConflicts('task-B', ['src/a.js', 'src/b.js', 'src/new.js']);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].files).toEqual(expect.arrayContaining(['src/a.js', 'src/b.js']));
      expect(conflicts[0].files).toHaveLength(2);
    });

    it('detects conflicts with multiple active tasks', () => {
      registerActiveTaskFiles('task-A', ['src/alpha.js']);
      registerActiveTaskFiles('task-B', ['src/beta.js']);

      const { conflicts } = detectParallelConflicts('task-C', ['src/alpha.js', 'src/beta.js']);

      expect(conflicts).toHaveLength(2);
      const conflictingIds = conflicts.map(c => c.conflictingTaskId);
      expect(conflictingIds).toContain('task-A');
      expect(conflictingIds).toContain('task-B');
    });

    it('does not conflict a task with itself', () => {
      registerActiveTaskFiles('task-A', ['src/foo.js']);

      const { conflicts } = detectParallelConflicts('task-A', ['src/foo.js']);

      expect(conflicts).toHaveLength(0);
    });

    it('returns empty conflicts when files do not overlap', () => {
      registerActiveTaskFiles('task-A', ['src/foo.js', 'src/bar.js']);

      const { conflicts } = detectParallelConflicts('task-B', ['src/baz.js', 'src/qux.js']);

      expect(conflicts).toHaveLength(0);
    });

    it('emits CANARY_PARALLEL_CONFLICT event for each conflict', () => {
      registerActiveTaskFiles('task-A', ['src/shared.js']);

      detectParallelConflicts('task-B', ['src/shared.js']);

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        'canary:parallel-conflict',
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskId: 'task-B',
            conflictingTaskId: 'task-A',
            files: ['src/shared.js'],
          }),
        }),
      );
    });

    it('does not emit events when no conflicts', () => {
      registerActiveTaskFiles('task-A', ['src/foo.js']);

      detectParallelConflicts('task-B', ['src/bar.js']);

      expect(eventBus.emitEvent).not.toHaveBeenCalled();
    });

    it('handles empty filesChanged gracefully', () => {
      registerActiveTaskFiles('task-A', ['src/foo.js']);

      const { conflicts } = detectParallelConflicts('task-B', []);
      expect(conflicts).toHaveLength(0);
    });

    it('handles null taskId gracefully', () => {
      const { conflicts } = detectParallelConflicts(null, ['src/foo.js']);
      expect(conflicts).toHaveLength(0);
    });
  });
});
