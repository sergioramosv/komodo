/**
 * E2E tests: full cost tracking cycle
 *
 * Tests the complete integration of:
 *   BudgetManager ↔ EventBus ↔ KomodoState ↔ Telegram Notifier ↔ Firebase persistence
 *
 * Flow under test:
 *   tracking → 80% warning alert → 100% exceeded + auto-pause → daily reset + resume
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks for external dependencies only ────────────────────────────────────

vi.mock('../config.js', () => ({
  config: {
    dailyBudgetUsd: 10,
    weeklyBudgetUsd: 50,
    budgetWarningThreshold: 0.8,
    estimatedCostPerInvocation: 0.05,
    enableTelegram: true,
    telegramChatId: 'test-chat-id',
    telegramVerbosity: 'minimal',
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

// Real-like EventBus (EventEmitter-based) — captures real event flow
vi.mock('../events/event-bus.js', async () => {
  const { EventEmitter } = await import('events');
  const bus = new EventEmitter();
  bus.setMaxListeners(50);
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
  bus.off = (event, listener) => bus.removeListener(event, listener);
  return {
    eventBus: bus,
    EVENT_TYPES: {
      BUDGET_WARNING: 'budget:warning',
      BUDGET_EXCEEDED: 'budget:exceeded',
      BUDGET_RESET: 'budget:reset',
      BUDGET_UPDATED: 'budget:updated',
      COST_UPDATED: 'cost:updated',
      TASK_STARTED: 'task:started',
      TASK_COMPLETED: 'task:completed',
      PR_CREATED: 'pr:created',
      PR_MERGED: 'pr:merged',
      REVIEW_CYCLE_END: 'review:cycle:end',
      AGENT_CODER_DONE: 'agent:coder:done',
      CLI_RECOVERED: 'cli:recovered',
      ALL_CLIS_RATE_LIMITED: 'cli:all-rate-limited',
      DAEMON_STARTED: 'daemon:started',
      DAEMON_STOPPED: 'daemon:stopped',
      DAEMON_IDLE: 'daemon:idle',
      DAEMON_TASK_DETECTED: 'daemon:task-detected',
      CI_PASSED: 'ci:passed',
      CI_FAILED: 'ci:failed',
      RELEASE_CREATED: 'release:created',
      RELEASE_GATE_BLOCKED: 'release:gate-blocked',
    },
  };
});

// KomodoState mock that tracks real state transitions
vi.mock('../state/komodo-state.js', () => {
  const state = {
    budget: {
      dailySpent: 0,
      weeklySpent: 0,
      dailyBudget: 0,
      weeklyBudget: 0,
      paused: false,
    },
    executionState: 'daemon:running',
    setExecutionState: vi.fn((newState) => {
      state.executionState = newState;
    }),
  };
  return {
    komodoState: state,
    EXECUTION_STATES: {
      BUDGET_PAUSED: 'budget:paused',
      DAEMON_RUNNING: 'daemon:running',
    },
  };
});

// Telegram bot mock — captures sent messages
const mockSendMessage = vi.fn(() => Promise.resolve());
vi.mock('../telegram/bot.js', () => ({
  getBot: vi.fn(() => ({ sendMessage: mockSendMessage })),
}));

// ── Module imports (after mocks) ────────────────────────────────────────────

const { budgetManager } = await import('./budget-manager.js');
const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { komodoState } = await import('../state/komodo-state.js');
const { startNotifier, stopNotifier } = await import('../telegram/notifier.js');
const { config } = await import('../config.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Collects all events of the given type emitted during `fn()`.
 * Registers the listener BEFORE calling fn and removes it after.
 */
function collectEvents(type, fn) {
  const captured = [];
  const listener = (payload) => captured.push(payload);
  eventBus.on(type, listener);
  fn();
  eventBus.off(type, listener);
  return captured;
}

// ── E2E Tests ────────────────────────────────────────────────────────────────

describe('Cost tracking E2E — full cycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset state between tests
    komodoState.executionState = 'daemon:running';
    komodoState.budget.paused = false;
    komodoState.budget.dailySpent = 0;
    komodoState.budget.weeklySpent = 0;

    // Reset config budgets
    config.dailyBudgetUsd = 10;
    config.weeklyBudgetUsd = 50;
    config.budgetWarningThreshold = 0.8;

    startNotifier();
    budgetManager.start({ projectId: 'e2e-project' });
  });

  afterEach(() => {
    budgetManager.stop();
    stopNotifier();
    vi.useRealTimers();
  });

  // ── Segment 1: cost accumulation tracking ─────────────────────────────────

  describe('cost accumulation tracking', () => {
    it('emits BUDGET_UPDATED for every cost recorded', () => {
      const updates = [];
      const listener = (p) => updates.push(p);
      eventBus.on(EVENT_TYPES.BUDGET_UPDATED, listener);

      budgetManager.recordCost(1.0, { agentName: 'PLANNER', taskId: 'task-1' });
      budgetManager.recordCost(2.0, { agentName: 'CODER', taskId: 'task-2' });
      budgetManager.recordCost(3.0, { agentName: 'REVIEWER', taskId: 'task-3' });

      eventBus.off(EVENT_TYPES.BUDGET_UPDATED, listener);

      expect(updates).toHaveLength(3);
      expect(updates[0].metadata.dailySpent).toBe(1.0);
      expect(updates[1].metadata.dailySpent).toBe(3.0);
      expect(updates[2].metadata.dailySpent).toBe(6.0);
    });

    it('accumulates costs from COST_UPDATED events emitted by agents', () => {
      // Simulate 3 agent invocations triggering COST_UPDATED
      eventBus.emit(EVENT_TYPES.COST_UPDATED, {
        type: EVENT_TYPES.COST_UPDATED,
        timestamp: new Date().toISOString(),
        agentName: 'PLANNER',
        metadata: { cost: 1.5, taskId: 'task-1' },
      });
      eventBus.emit(EVENT_TYPES.COST_UPDATED, {
        type: EVENT_TYPES.COST_UPDATED,
        timestamp: new Date().toISOString(),
        agentName: 'CODER',
        metadata: { cost: 2.0, taskId: 'task-1' },
      });
      eventBus.emit(EVENT_TYPES.COST_UPDATED, {
        type: EVENT_TYPES.COST_UPDATED,
        timestamp: new Date().toISOString(),
        agentName: 'REVIEWER',
        metadata: { cost: 0.5, taskId: 'task-1' },
      });

      const status = budgetManager.getStatus();
      expect(status.dailySpent).toBe(4.0);
      expect(status.weeklySpent).toBe(4.0);
    });

    it('syncs accumulated cost to komodoState.budget after each invocation', () => {
      budgetManager.recordCost(3.0, { agentName: 'CODER' });

      expect(komodoState.budget.dailySpent).toBe(3.0);
      expect(komodoState.budget.weeklySpent).toBe(3.0);
      expect(komodoState.budget.dailyBudget).toBe(10);
      expect(komodoState.budget.weeklyBudget).toBe(50);
    });

    it('getStatus returns correct percentages after partial spending', () => {
      budgetManager.recordCost(4.0);

      const status = budgetManager.getStatus();
      expect(status.dailyPercent).toBe(40);
      expect(status.weeklyPercent).toBeCloseTo(8);
      expect(status.exceeded).toBe(false);
    });
  });

  // ── Segment 2: 80% warning alert ──────────────────────────────────────────

  describe('80% warning alert', () => {
    it('emits BUDGET_WARNING when daily spend crosses 80% threshold', () => {
      const warnings = collectEvents(EVENT_TYPES.BUDGET_WARNING, () => {
        // $7.99 is below threshold, $0.01 more puts it exactly at 80%
        budgetManager.recordCost(7.99);
        budgetManager.recordCost(0.01);
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0].metadata.dailySpent).toBeCloseTo(8.0, 2);
      expect(warnings[0].metadata.percentDaily).toBe(80);
    });

    it('emits BUDGET_WARNING when weekly spend crosses 80% threshold', () => {
      // $40 = 80% of $50 weekly budget
      const warnings = collectEvents(EVENT_TYPES.BUDGET_WARNING, () => {
        budgetManager.recordCost(40.0);
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0].metadata.weeklySpent).toBe(40.0);
      expect(warnings[0].metadata.weeklyBudget).toBe(50);
    });

    it('sends Telegram notification when BUDGET_WARNING is emitted', () => {
      // sendNotification is called synchronously when the event fires
      budgetManager.recordCost(8.0);

      expect(mockSendMessage).toHaveBeenCalledWith(
        'test-chat-id',
        expect.any(String),
        expect.objectContaining({ parse_mode: 'MarkdownV2' }),
      );
    });

    it('emits warning only once per budget period — not on subsequent costs', () => {
      const warnings = collectEvents(EVENT_TYPES.BUDGET_WARNING, () => {
        budgetManager.recordCost(8.0); // triggers warning
        budgetManager.recordCost(0.5); // above threshold but warning already emitted
        budgetManager.recordCost(0.5); // still above, no second warning
      });

      expect(warnings).toHaveLength(1);
    });

    it('result.warning is true only on the first crossing', () => {
      const r1 = budgetManager.recordCost(8.0);
      const r2 = budgetManager.recordCost(0.5);

      expect(r1.warning).toBe(true);
      expect(r2.warning).toBe(false);
    });
  });

  // ── Segment 3: 100% exceeded + auto-pause ─────────────────────────────────

  describe('100% exceeded + daemon auto-pause', () => {
    it('emits BUDGET_EXCEEDED when daily budget is reached', () => {
      const exceeded = collectEvents(EVENT_TYPES.BUDGET_EXCEEDED, () => {
        budgetManager.recordCost(10.0);
      });

      expect(exceeded).toHaveLength(1);
      expect(exceeded[0].metadata.dailySpent).toBe(10.0);
      expect(exceeded[0].metadata.dailyBudget).toBe(10);
    });

    it('auto-pauses daemon when budget is exceeded', () => {
      budgetManager.recordCost(10.0);

      expect(komodoState.setExecutionState).toHaveBeenCalledWith('budget:paused');
      expect(komodoState.executionState).toBe('budget:paused');
      expect(komodoState.budget.paused).toBe(true);
    });

    it('sends Telegram notification when BUDGET_EXCEEDED is emitted', () => {
      // sendNotification is called synchronously when the event fires
      budgetManager.recordCost(10.0);

      // Second call because warning (80%) fires before exceeded (100%)
      const exceededCall = mockSendMessage.mock.calls.at(-1);
      expect(exceededCall[0]).toBe('test-chat-id');
      expect(exceededCall[2]).toMatchObject({ parse_mode: 'MarkdownV2' });
    });

    it('getStatus reports exceeded=true after budget is exceeded', () => {
      budgetManager.recordCost(11.0);

      const status = budgetManager.getStatus();
      expect(status.exceeded).toBe(true);
    });

    it('recordCost returns allowed=false after budget is exceeded', () => {
      budgetManager.recordCost(10.0);
      const result = budgetManager.recordCost(0.5);

      expect(result.allowed).toBe(false);
      expect(result.exceeded).toBe(true);
    });

    it('emits BUDGET_EXCEEDED only once — not on every subsequent cost', () => {
      const exceeded = collectEvents(EVENT_TYPES.BUDGET_EXCEEDED, () => {
        budgetManager.recordCost(10.0);
        budgetManager.recordCost(1.0);
        budgetManager.recordCost(1.0);
      });

      expect(exceeded).toHaveLength(1);
    });

    it('both warning (80%) and exceeded (100%) fire in sequence for a single task session', () => {
      const events = [];
      const warningListener = () => events.push('warning');
      const exceededListener = () => events.push('exceeded');

      eventBus.on(EVENT_TYPES.BUDGET_WARNING, warningListener);
      eventBus.on(EVENT_TYPES.BUDGET_EXCEEDED, exceededListener);

      // Simulate a task session crossing both thresholds
      budgetManager.recordCost(4.0); // 40% — no event
      budgetManager.recordCost(4.0); // 80% — warning
      budgetManager.recordCost(2.0); // 100% — exceeded

      eventBus.off(EVENT_TYPES.BUDGET_WARNING, warningListener);
      eventBus.off(EVENT_TYPES.BUDGET_EXCEEDED, exceededListener);

      expect(events).toEqual(['warning', 'exceeded']);
    });
  });

  // ── Segment 4: daily reset ─────────────────────────────────────────────────

  describe('daily reset', () => {
    it('resets daily counter and emits BUDGET_RESET when day changes via setInterval', () => {
      budgetManager.recordCost(5.0);
      expect(budgetManager.getStatus().dailySpent).toBe(5.0);

      // Register listener BEFORE advancing time — the setInterval fires _checkReset
      // which emits BUDGET_RESET when it detects the day boundary crossing
      const resets = [];
      const resetListener = (p) => resets.push(p);
      eventBus.on(EVENT_TYPES.BUDGET_RESET, resetListener);

      // Advance 24 hours — the 60s interval fires ~1440 times, crossing midnight
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      eventBus.off(EVENT_TYPES.BUDGET_RESET, resetListener);

      expect(resets).toHaveLength(1);
      // After reset, daily counter should be zero
      expect(budgetManager.getStatus().dailySpent).toBe(0);
    });

    it('resumes daemon (sets state to daemon:running) after daily reset when budget was paused', () => {
      // Exceed budget → daemon paused
      budgetManager.recordCost(10.0);
      expect(komodoState.executionState).toBe('budget:paused');

      // Advance past midnight to trigger daily reset via setInterval
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      expect(komodoState.setExecutionState).toHaveBeenCalledWith('daemon:running');
      expect(komodoState.budget.paused).toBe(false);
    });

    it('allows new warning to be emitted after daily reset', () => {
      // Exhaust warning for today
      budgetManager.recordCost(8.0);

      // Advance past midnight to trigger reset
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      // Now warning should fire again for the new day
      const warnings = collectEvents(EVENT_TYPES.BUDGET_WARNING, () => {
        budgetManager.recordCost(8.0);
      });

      expect(warnings).toHaveLength(1);
    });

    it('BUDGET_RESET payload includes day and budget config values', () => {
      const resets = [];
      const resetListener = (p) => resets.push(p);
      eventBus.on(EVENT_TYPES.BUDGET_RESET, resetListener);

      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      eventBus.off(EVENT_TYPES.BUDGET_RESET, resetListener);

      expect(resets).toHaveLength(1);
      expect(resets[0].metadata).toMatchObject({
        dailyBudget: 10,
        weeklyBudget: 50,
      });
      expect(resets[0].metadata.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ── Segment 5: full cycle integration ─────────────────────────────────────

  describe('complete cycle: tracking → 80% alert → 100% pause → daily reset', () => {
    it('runs the full cost tracking lifecycle end-to-end', () => {
      const emittedEvents = [];
      const updatedListener = () => emittedEvents.push('updated');
      const warningListener = () => emittedEvents.push('warning');
      const exceededListener = () => emittedEvents.push('exceeded');
      const resetListener = () => emittedEvents.push('reset');

      eventBus.on(EVENT_TYPES.BUDGET_UPDATED, updatedListener);
      eventBus.on(EVENT_TYPES.BUDGET_WARNING, warningListener);
      eventBus.on(EVENT_TYPES.BUDGET_EXCEEDED, exceededListener);
      eventBus.on(EVENT_TYPES.BUDGET_RESET, resetListener);

      // --- Phase 1: normal tracking (PLANNER + CODER + REVIEWER cycle) ---
      // 3 tasks × 3 agents = 9 invocations at ~$0.5 each = $4.50 total
      for (let i = 0; i < 9; i++) {
        budgetManager.recordCost(0.5, { agentName: 'AGENT', taskId: `task-${i}` });
      }
      expect(budgetManager.getStatus().dailySpent).toBe(4.5);
      expect(komodoState.executionState).toBe('daemon:running');

      // --- Phase 2: 80% warning ---
      budgetManager.recordCost(3.5); // total: $8.00 — 80% of $10
      expect(emittedEvents).toContain('warning');
      expect(komodoState.executionState).toBe('daemon:running'); // still running after warning

      // --- Phase 3: 100% exceeded + auto-pause ---
      budgetManager.recordCost(2.0); // total: $10.00 — 100% of $10
      expect(emittedEvents).toContain('exceeded');
      expect(komodoState.executionState).toBe('budget:paused');
      expect(komodoState.budget.paused).toBe(true);

      // Daemon cannot run new agents while paused
      const status = budgetManager.getStatus();
      expect(status.exceeded).toBe(true);
      expect(status.dailyPercent).toBe(100);

      // --- Phase 4: daily reset (triggered by setInterval crossing midnight) ---
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      expect(emittedEvents).toContain('reset');
      expect(komodoState.budget.paused).toBe(false);
      expect(komodoState.setExecutionState).toHaveBeenCalledWith('daemon:running');

      // New day starts fresh
      const newDayStatus = budgetManager.getStatus();
      expect(newDayStatus.dailySpent).toBe(0);
      expect(newDayStatus.exceeded).toBe(false);

      // --- Verify event sequence ---
      expect(emittedEvents.filter(e => e === 'updated').length).toBeGreaterThanOrEqual(10);
      expect(emittedEvents.filter(e => e === 'warning').length).toBe(1);
      expect(emittedEvents.filter(e => e === 'exceeded').length).toBe(1);
      expect(emittedEvents.filter(e => e === 'reset').length).toBe(1);

      eventBus.off(EVENT_TYPES.BUDGET_UPDATED, updatedListener);
      eventBus.off(EVENT_TYPES.BUDGET_WARNING, warningListener);
      eventBus.off(EVENT_TYPES.BUDGET_EXCEEDED, exceededListener);
      eventBus.off(EVENT_TYPES.BUDGET_RESET, resetListener);
    });

    it('Firebase persistence is called throughout the cycle', () => {
      budgetManager.stop();

      const mockPersist = vi.fn(async () => {});
      budgetManager.start({ projectId: 'e2e-project', persistFn: mockPersist });

      // Normal tracking
      budgetManager.recordCost(2.0, { agentName: 'PLANNER' });
      budgetManager.recordCost(3.0, { agentName: 'CODER' });

      // Warning threshold
      budgetManager.recordCost(3.0, { agentName: 'REVIEWER' }); // $8 total → warning

      // Exceed
      budgetManager.recordCost(2.0, { agentName: 'PLANNER' }); // $10 total → exceeded

      expect(mockPersist).toHaveBeenCalledTimes(4);
      expect(mockPersist).toHaveBeenCalledWith(
        'e2e-project',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        expect.any(Number),
      );

      // Last call should have accumulated total
      const lastCall = mockPersist.mock.calls.at(-1);
      expect(lastCall[2]).toBe(10.0);
    });

    it('Telegram alerts fire for both warning and exceeded events in sequence', () => {
      // sendNotification is called synchronously from the event handlers
      budgetManager.recordCost(8.0); // → 80% warning → 1 Telegram message
      budgetManager.recordCost(2.0); // → 100% exceeded → 1 Telegram message

      // Two separate Telegram notifications sent
      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      const calls = mockSendMessage.mock.calls;

      // Both sent to correct chat
      expect(calls.every(([chatId]) => chatId === 'test-chat-id')).toBe(true);

      // Both with MarkdownV2 parse mode
      expect(calls.every(([, , opts]) => opts.parse_mode === 'MarkdownV2')).toBe(true);
    });
  });
});
