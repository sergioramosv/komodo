import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../events/event-bus.js', () => {
  const emitEvent = vi.fn(() => ({}));
  return {
    eventBus: { emitEvent },
    EVENT_TYPES: {
      CIRCUIT_OPEN: 'circuit:open',
      CIRCUIT_HALF_OPEN: 'circuit:half-open',
      CIRCUIT_CLOSED: 'circuit:closed',
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
    cbFirebaseThreshold: 5,
    cbGithubThreshold: 3,
    cbCliThreshold: 4,
    cbCooldownSeconds: 60,
    cbHalfOpenMaxAttempts: 2,
  },
}));

const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { CircuitBreaker, CB_STATES, circuits } = await import('./circuit-breaker.js');

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    vi.clearAllMocks();
    cb = new CircuitBreaker('test', { threshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 2 });
  });

  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      expect(cb.state).toBe(CB_STATES.CLOSED);
      expect(cb.canExecute()).toBe(true);
    });
  });

  describe('CLOSED → OPEN transition', () => {
    it('opens after reaching failure threshold', () => {
      cb.recordFailure('err1');
      cb.recordFailure('err2');
      expect(cb.state).toBe(CB_STATES.CLOSED);

      cb.recordFailure('err3');
      expect(cb.state).toBe(CB_STATES.OPEN);
      expect(cb.canExecute()).toBe(false);
    });

    it('emits circuit:open event', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure();
      expect(eventBus.emitEvent).toHaveBeenCalledWith(EVENT_TYPES.CIRCUIT_OPEN, {
        metadata: { circuit: 'test', failureCount: 3 },
      });
    });
  });

  describe('OPEN → HALF_OPEN transition', () => {
    it('transitions to HALF_OPEN after cooldown expires', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure();
      expect(cb.state).toBe(CB_STATES.OPEN);

      // Simulate cooldown elapsed
      cb.openedAt = Date.now() - 2000;
      expect(cb.canExecute()).toBe(true);
      expect(cb.state).toBe(CB_STATES.HALF_OPEN);
    });

    it('emits circuit:half-open event', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure();
      cb.openedAt = Date.now() - 2000;
      cb.canExecute();
      expect(eventBus.emitEvent).toHaveBeenCalledWith(EVENT_TYPES.CIRCUIT_HALF_OPEN, {
        metadata: { circuit: 'test' },
      });
    });
  });

  describe('HALF_OPEN → CLOSED transition', () => {
    it('closes on success in HALF_OPEN', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure();
      cb.openedAt = Date.now() - 2000;
      cb.canExecute(); // transition to HALF_OPEN

      cb.recordSuccess();
      expect(cb.state).toBe(CB_STATES.CLOSED);
      expect(cb.failureCount).toBe(0);
    });

    it('emits circuit:closed event', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure();
      cb.openedAt = Date.now() - 2000;
      cb.canExecute();
      cb.recordSuccess();
      expect(eventBus.emitEvent).toHaveBeenCalledWith(EVENT_TYPES.CIRCUIT_CLOSED, {
        metadata: { circuit: 'test', previousState: CB_STATES.HALF_OPEN },
      });
    });
  });

  describe('HALF_OPEN → OPEN re-opening', () => {
    it('re-opens after max half-open failures', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure();
      cb.openedAt = Date.now() - 2000;
      cb.canExecute(); // HALF_OPEN

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.state).toBe(CB_STATES.OPEN);
    });
  });

  describe('reset', () => {
    it('resets to CLOSED state', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure();
      expect(cb.state).toBe(CB_STATES.OPEN);

      cb.reset();
      expect(cb.state).toBe(CB_STATES.CLOSED);
      expect(cb.failureCount).toBe(0);
      expect(cb.canExecute()).toBe(true);
    });
  });

  describe('getSnapshot', () => {
    it('returns current state info', () => {
      cb.recordFailure('test-error');
      const snap = cb.getSnapshot();
      expect(snap.name).toBe('test');
      expect(snap.state).toBe(CB_STATES.CLOSED);
      expect(snap.failureCount).toBe(1);
    });
  });
});

describe('pre-configured circuits', () => {
  it('creates firebase, github, and cli circuits', () => {
    expect(circuits.firebase).toBeInstanceOf(CircuitBreaker);
    expect(circuits.github).toBeInstanceOf(CircuitBreaker);
    expect(circuits.cli).toBeInstanceOf(CircuitBreaker);
  });

  it('firebase has threshold 5', () => {
    expect(circuits.firebase.threshold).toBe(5);
  });

  it('github has threshold 3', () => {
    expect(circuits.github.threshold).toBe(3);
  });

  it('cli has threshold 4', () => {
    expect(circuits.cli.threshold).toBe(4);
  });
});
