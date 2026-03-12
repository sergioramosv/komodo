import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Fresh instance per import — we re-import in beforeEach
let FlakyTestRegistry;

describe('FlakyTestRegistry', () => {
  let registry;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get a fresh class (bypass module cache)
    const mod = await import('./flaky-test-registry.js');
    // The module exports a singleton; we replicate the class behavior with a fresh object
    registry = Object.create(mod.flakyTestRegistry);
    registry._registry = {};
    registry._loaded = true; // skip file I/O in tests
  });

  describe('register', () => {
    it('registers a new test with failCount=1', () => {
      registry.register('my-test');
      const snap = registry.getSnapshot();
      expect(snap['my-test']).toBeDefined();
      expect(snap['my-test'].failCount).toBe(1);
      expect(snap['my-test'].passCount).toBe(0);
    });

    it('increments failCount on repeated register', () => {
      registry.register('my-test');
      registry.register('my-test');
      expect(registry.getSnapshot()['my-test'].failCount).toBe(2);
    });
  });

  describe('isKnownFlaky', () => {
    it('returns false for unknown test', () => {
      expect(registry.isKnownFlaky('unknown')).toBe(false);
    });

    it('returns false for registered test with zero passes', () => {
      registry.register('my-test');
      expect(registry.isKnownFlaky('my-test')).toBe(false);
    });

    it('returns true when test has passed after failing', () => {
      registry.register('my-test');
      registry.recordRetryResult('my-test', true);
      expect(registry.isKnownFlaky('my-test')).toBe(true);
    });
  });

  describe('recordRetryResult', () => {
    it('increments passCount on pass', () => {
      registry.register('my-test');
      registry.recordRetryResult('my-test', true);
      expect(registry.getSnapshot()['my-test'].passCount).toBe(1);
    });

    it('increments failCount on fail', () => {
      registry.register('my-test');
      registry.recordRetryResult('my-test', false);
      expect(registry.getSnapshot()['my-test'].failCount).toBe(2);
    });

    it('creates entry if test was not previously registered', () => {
      registry.recordRetryResult('new-test', true);
      const entry = registry.getSnapshot()['new-test'];
      expect(entry).toBeDefined();
      expect(entry.passCount).toBe(1);
    });
  });

  describe('getAllFlaky', () => {
    it('returns only tests with passCount > 0', () => {
      registry.register('flaky-one');
      registry.recordRetryResult('flaky-one', true);
      registry.register('not-flaky');
      expect(registry.getAllFlaky()).toEqual(['flaky-one']);
    });
  });
});
