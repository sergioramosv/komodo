import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  config: {
    dailyBudgetUsd: 10,
    weeklyBudgetUsd: 50,
    budgetWarningThreshold: 0.8,
    estimatedCostPerInvocation: 0.05,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', async () => {
  const { EventEmitter } = await import('events');
  const bus = new EventEmitter();
  bus.emitEvent = vi.fn((type, data) => {
    const payload = {
      type,
      timestamp: new Date().toISOString(),
      agentName: data?.agentName || null,
      metadata: data?.metadata || {},
    };
    bus.emit(type, payload);
    return payload;
  });
  return {
    eventBus: bus,
    EVENT_TYPES: {
      BUDGET_WARNING: 'budget:warning',
      BUDGET_EXCEEDED: 'budget:exceeded',
      BUDGET_RESET: 'budget:reset',
      BUDGET_UPDATED: 'budget:updated',
      COST_UPDATED: 'cost:updated',
      EXECUTION_STATE_CHANGE: 'execution:state-change',
    },
  };
});

vi.mock('../state/komodo-state.js', () => ({
  komodoState: {
    budget: {
      dailySpent: 0,
      weeklySpent: 0,
      dailyBudget: 0,
      weeklyBudget: 0,
      paused: false,
    },
    executionState: 'daemon:running',
    setExecutionState: vi.fn(),
  },
  EXECUTION_STATES: {
    BUDGET_PAUSED: 'budget:paused',
    DAEMON_RUNNING: 'daemon:running',
  },
}));

const { budgetManager } = await import('./budget-manager.js');
const { eventBus } = await import('../events/event-bus.js');
const { config } = await import('../config.js');
const { komodoState } = await import('../state/komodo-state.js');

// ── Tests ──────────────────────────────────────────────────────────

describe('BudgetManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    budgetManager.start();
  });

  afterEach(() => {
    budgetManager.stop();
    vi.useRealTimers();
  });

  // ── recordCost ──────────────────────────────────────────

  describe('recordCost', () => {
    it('tracks daily and weekly spending', () => {
      const result = budgetManager.recordCost(1.0);

      expect(result.dailySpent).toBe(1.0);
      expect(result.weeklySpent).toBe(1.0);
      expect(result.allowed).toBe(true);
      expect(result.exceeded).toBe(false);
    });

    it('uses default cost from config when no amount provided', () => {
      const result = budgetManager.recordCost();

      expect(result.dailySpent).toBe(0.05);
    });

    it('accumulates multiple costs', () => {
      budgetManager.recordCost(2.0);
      budgetManager.recordCost(3.0);
      const result = budgetManager.recordCost(1.0);

      expect(result.dailySpent).toBe(6.0);
      expect(result.weeklySpent).toBe(6.0);
    });

    it('emits BUDGET_UPDATED event on each cost', () => {
      budgetManager.recordCost(1.0);

      expect(eventBus.emitEvent).toHaveBeenCalledWith('budget:updated', expect.objectContaining({
        metadata: expect.objectContaining({
          cost: 1.0,
          dailySpent: 1.0,
          weeklySpent: 1.0,
        }),
      }));
    });
  });

  // ── Warning at 80% ──────────────────────────────────────

  describe('budget warning at 80%', () => {
    it('emits BUDGET_WARNING when daily spend reaches 80%', () => {
      // dailyBudget = $10, 80% = $8
      budgetManager.recordCost(8.0);

      expect(eventBus.emitEvent).toHaveBeenCalledWith('budget:warning', expect.objectContaining({
        metadata: expect.objectContaining({
          dailySpent: 8.0,
          dailyBudget: 10,
        }),
      }));
    });

    it('emits BUDGET_WARNING when weekly spend reaches 80%', () => {
      // weeklyBudget = $50, 80% = $40
      budgetManager.recordCost(40.0);

      expect(eventBus.emitEvent).toHaveBeenCalledWith('budget:warning', expect.objectContaining({
        metadata: expect.objectContaining({
          weeklySpent: 40.0,
          weeklyBudget: 50,
        }),
      }));
    });

    it('does not emit warning twice for the same period', () => {
      budgetManager.recordCost(8.0);
      budgetManager.recordCost(0.5);

      const warningCalls = eventBus.emitEvent.mock.calls.filter(
        ([type]) => type === 'budget:warning',
      );
      expect(warningCalls.length).toBe(1);
    });
  });

  // ── Exceeded at 100% ────────────────────────────────────

  describe('budget exceeded at 100%', () => {
    it('emits BUDGET_EXCEEDED and auto-pauses when daily budget is exceeded', () => {
      budgetManager.recordCost(10.0);

      expect(eventBus.emitEvent).toHaveBeenCalledWith('budget:exceeded', expect.objectContaining({
        metadata: expect.objectContaining({
          dailySpent: 10.0,
          dailyBudget: 10,
        }),
      }));

      expect(komodoState.setExecutionState).toHaveBeenCalledWith('budget:paused');
      expect(komodoState.budget.paused).toBe(true);
    });

    it('returns allowed=false when budget is exceeded', () => {
      const result = budgetManager.recordCost(11.0);

      expect(result.allowed).toBe(false);
      expect(result.exceeded).toBe(true);
    });

    it('emits exceeded only once per period', () => {
      budgetManager.recordCost(10.0);
      budgetManager.recordCost(1.0);

      const exceededCalls = eventBus.emitEvent.mock.calls.filter(
        ([type]) => type === 'budget:exceeded',
      );
      expect(exceededCalls.length).toBe(1);
    });
  });

  // ── No limit when budget is 0 ──────────────────────────

  describe('no limit mode', () => {
    it('never warns or exceeds when dailyBudget=0', () => {
      config.dailyBudgetUsd = 0;
      config.weeklyBudgetUsd = 0;

      budgetManager.recordCost(1000);

      const warningCalls = eventBus.emitEvent.mock.calls.filter(
        ([type]) => type === 'budget:warning',
      );
      const exceededCalls = eventBus.emitEvent.mock.calls.filter(
        ([type]) => type === 'budget:exceeded',
      );

      expect(warningCalls.length).toBe(0);
      expect(exceededCalls.length).toBe(0);

      // Restore
      config.dailyBudgetUsd = 10;
      config.weeklyBudgetUsd = 50;
    });
  });

  // ── Period reset ────────────────────────────────────────

  describe('period reset', () => {
    it('resets daily counter when day changes', () => {
      budgetManager.recordCost(5.0);

      // Advance 1 day
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      // Trigger reset check via recordCost
      const result = budgetManager.recordCost(1.0);

      expect(result.dailySpent).toBe(1.0);
    });

    it('emits BUDGET_RESET on period change', () => {
      budgetManager.recordCost(5.0);

      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      budgetManager.recordCost(1.0);

      expect(eventBus.emitEvent).toHaveBeenCalledWith('budget:reset', expect.objectContaining({
        metadata: expect.objectContaining({
          dailyBudget: 10,
          weeklyBudget: 50,
        }),
      }));
    });

    it('resumes daemon if it was budget-paused after reset', () => {
      budgetManager.recordCost(10.0); // exceed
      komodoState.executionState = 'budget:paused';

      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      budgetManager.recordCost(1.0);

      expect(komodoState.setExecutionState).toHaveBeenCalledWith('daemon:running');
    });
  });

  // ── getStatus ───────────────────────────────────────────

  describe('getStatus', () => {
    it('returns current budget status', () => {
      budgetManager.recordCost(3.0);

      const status = budgetManager.getStatus();

      expect(status.dailySpent).toBe(3.0);
      expect(status.weeklySpent).toBe(3.0);
      expect(status.dailyBudget).toBe(10);
      expect(status.weeklyBudget).toBe(50);
      expect(status.dailyPercent).toBe(30);
      expect(status.weeklyPercent).toBe(6);
      expect(status.exceeded).toBe(false);
    });
  });

  // ── Firebase persistence ────────────────────────────────

  describe('Firebase persistence', () => {
    it('calls persistFn on each recordCost when configured', () => {
      budgetManager.stop();

      const mockPersist = vi.fn(async () => {});
      budgetManager.start({ projectId: 'test-proj', persistFn: mockPersist });

      budgetManager.recordCost(1.0);

      expect(mockPersist).toHaveBeenCalledWith(
        'test-proj',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        1.0,
      );
    });
  });

  // ── Auto listener for COST_UPDATED ──────────────────────

  describe('COST_UPDATED auto-listener', () => {
    it('records cost when a cost:updated event is emitted', () => {
      // Emit a cost:updated event as if an agent reported it
      eventBus.emit('cost:updated', {
        type: 'cost:updated',
        timestamp: new Date().toISOString(),
        agentName: 'CODER',
        metadata: { cost: 2.5, taskId: 'task-123' },
      });

      const status = budgetManager.getStatus();
      expect(status.dailySpent).toBe(2.5);
    });
  });
});
