import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../events/event-bus.js', () => {
  const emitEvent = vi.fn(() => ({}));
  return {
    eventBus: { emitEvent },
    EVENT_TYPES: {
      ERROR_BUDGET_EXHAUSTED: 'error-budget:exhausted',
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
    errorBudgetWindowMinutes: 30,
    errorBudgetMaxFailureRate: 0.3,
  },
}));

const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { ErrorBudget } = await import('./error-budget.js');

describe('ErrorBudget', () => {
  let budget;

  beforeEach(() => {
    vi.clearAllMocks();
    budget = new ErrorBudget({ windowMs: 60000, maxFailureRate: 0.3 });
  });

  describe('getFailureRate', () => {
    it('returns 0 when no records', () => {
      expect(budget.getFailureRate()).toBe(0);
    });

    it('calculates failure rate correctly', () => {
      budget.record(true);
      budget.record(false);
      budget.record(true);
      budget.record(true);
      expect(budget.getFailureRate()).toBe(0.25);
    });
  });

  describe('budget exhaustion', () => {
    it('does not trigger with fewer than 3 records', () => {
      budget.record(false);
      budget.record(false);
      expect(budget.exhausted).toBe(false);
      expect(eventBus.emitEvent).not.toHaveBeenCalled();
    });

    it('triggers when failure rate exceeds threshold', () => {
      budget.record(false);
      budget.record(false);
      budget.record(false); // 100% failure rate > 30%
      expect(budget.exhausted).toBe(true);
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.ERROR_BUDGET_EXHAUSTED,
        expect.objectContaining({
          metadata: expect.objectContaining({
            failureRate: 1,
            maxFailureRate: 0.3,
          }),
        }),
      );
    });

    it('does not emit duplicate events', () => {
      budget.record(false);
      budget.record(false);
      budget.record(false);
      budget.record(false);
      expect(eventBus.emitEvent).toHaveBeenCalledTimes(1);
    });

    it('recovers when rate drops below threshold', () => {
      budget.record(false);
      budget.record(false);
      budget.record(false);
      expect(budget.exhausted).toBe(true);

      // Add successes to bring rate below 30%
      budget.record(true);
      budget.record(true);
      budget.record(true);
      budget.record(true);
      budget.record(true);
      budget.record(true);
      budget.record(true);
      // 3 failures out of 10 = 30%, not > 30%
      expect(budget.exhausted).toBe(false);
    });
  });

  describe('sliding window', () => {
    it('prunes expired records', () => {
      // Add records with old timestamps
      budget.records.push({ timestamp: Date.now() - 120000, success: false });
      budget.records.push({ timestamp: Date.now() - 120000, success: false });
      budget.records.push({ timestamp: Date.now() - 120000, success: false });

      // After pruning, old records should be gone (window is 60s)
      expect(budget.getFailureRate()).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all records and exhausted flag', () => {
      budget.record(false);
      budget.record(false);
      budget.record(false);
      expect(budget.exhausted).toBe(true);

      budget.reset();
      expect(budget.records).toHaveLength(0);
      expect(budget.exhausted).toBe(false);
    });
  });

  describe('getSnapshot', () => {
    it('returns current state', () => {
      budget.record(true);
      budget.record(true);
      budget.record(true);
      budget.record(false);
      const snap = budget.getSnapshot();
      expect(snap.totalRecords).toBe(4);
      expect(snap.exhausted).toBe(false);
      expect(snap.maxFailureRate).toBe(0.3);
    });
  });
});
