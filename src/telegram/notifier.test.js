import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    telegramVerbosity: 'minimal',
    enableTelegram: true,
    telegramChatId: '123456',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockSendMessage = vi.fn(() => Promise.resolve());
vi.mock('./bot.js', () => ({
  getBot: vi.fn(() => ({ sendMessage: mockSendMessage })),
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
  },
  EVENT_TYPES: {
    TASK_STARTED: 'task:started',
    TASK_COMPLETED: 'task:completed',
    PR_CREATED: 'pr:created',
    PR_MERGED: 'pr:merged',
    REVIEW_CYCLE_END: 'review:cycle:end',
    AGENT_CODER_DONE: 'agent:coder:done',
    CLI_RECOVERED: 'cli:recovered',
    ALL_CLIS_RATE_LIMITED: 'cli:all-rate-limited',
    BUDGET_WARNING: 'budget:warning',
    BUDGET_EXCEEDED: 'budget:exceeded',
  },
}));

const { config } = await import('../config.js');
const { eventBus, EVENT_TYPES } = await import('../events/event-bus.js');
const { shouldNotify, startNotifier, stopNotifier } = await import('./notifier.js');

describe('shouldNotify', () => {
  beforeEach(() => {
    config.telegramVerbosity = 'minimal';
  });

  describe('minimal verbosity', () => {
    it('allows TASK_STARTED', () => {
      expect(shouldNotify(EVENT_TYPES.TASK_STARTED)).toBe(true);
    });

    it('allows TASK_COMPLETED', () => {
      expect(shouldNotify(EVENT_TYPES.TASK_COMPLETED)).toBe(true);
    });

    it('allows PR_MERGED', () => {
      expect(shouldNotify(EVENT_TYPES.PR_MERGED)).toBe(true);
    });

    it('allows CLI_RECOVERED', () => {
      expect(shouldNotify(EVENT_TYPES.CLI_RECOVERED)).toBe(true);
    });

    it('allows ALL_CLIS_RATE_LIMITED', () => {
      expect(shouldNotify(EVENT_TYPES.ALL_CLIS_RATE_LIMITED)).toBe(true);
    });

    it('blocks PR_CREATED', () => {
      expect(shouldNotify(EVENT_TYPES.PR_CREATED)).toBe(false);
    });

    it('blocks REVIEW_CYCLE_END', () => {
      expect(shouldNotify(EVENT_TYPES.REVIEW_CYCLE_END)).toBe(false);
    });

    it('blocks unknown events', () => {
      expect(shouldNotify('unknown:event')).toBe(false);
    });
  });

  describe('verbose verbosity', () => {
    beforeEach(() => {
      config.telegramVerbosity = 'verbose';
    });

    it('allows TASK_STARTED', () => {
      expect(shouldNotify(EVENT_TYPES.TASK_STARTED)).toBe(true);
    });

    it('allows TASK_COMPLETED', () => {
      expect(shouldNotify(EVENT_TYPES.TASK_COMPLETED)).toBe(true);
    });

    it('allows PR_MERGED', () => {
      expect(shouldNotify(EVENT_TYPES.PR_MERGED)).toBe(true);
    });

    it('allows PR_CREATED', () => {
      expect(shouldNotify(EVENT_TYPES.PR_CREATED)).toBe(true);
    });

    it('allows REVIEW_CYCLE_END', () => {
      expect(shouldNotify(EVENT_TYPES.REVIEW_CYCLE_END)).toBe(true);
    });

    it('blocks unknown events', () => {
      expect(shouldNotify('unknown:event')).toBe(false);
    });
  });
});

describe('startNotifier integration', () => {
  /** Find the handler registered for a given event type. */
  function getHandler(eventType) {
    const call = eventBus.on.mock.calls.find(c => c[0] === eventType);
    return call ? call[1] : null;
  }

  beforeEach(() => {
    config.telegramVerbosity = 'minimal';
    config.enableTelegram = true;
    config.telegramChatId = '123456';
    mockSendMessage.mockClear();
    eventBus.on.mockClear();
    eventBus.off.mockClear();

    startNotifier();
  });

  afterEach(() => {
    stopNotifier();
  });

  it('registers listeners for all expected events on start', () => {
    const registeredEvents = eventBus.on.mock.calls.map(c => c[0]);
    expect(registeredEvents).toContain(EVENT_TYPES.TASK_STARTED);
    expect(registeredEvents).toContain(EVENT_TYPES.PR_CREATED);
    expect(registeredEvents).toContain(EVENT_TYPES.REVIEW_CYCLE_END);
    expect(registeredEvents).toContain(EVENT_TYPES.AGENT_CODER_DONE);
    expect(registeredEvents).toContain(EVENT_TYPES.PR_MERGED);
    expect(registeredEvents).toContain(EVENT_TYPES.TASK_COMPLETED);
  });

  it('sends message on TASK_STARTED event', () => {
    const handler = getHandler(EVENT_TYPES.TASK_STARTED);
    handler({ metadata: { title: 'Test task', taskId: 'T-1', branchName: 'feat/test' } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Planner'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('sends message on TASK_COMPLETED with approved=true', () => {
    const handler = getHandler(EVENT_TYPES.TASK_COMPLETED);
    handler({ metadata: { approved: true, title: 'Done task', prNumber: 5 } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Tarea completada'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('sends error message on TASK_COMPLETED with approved=false', () => {
    const handler = getHandler(EVENT_TYPES.TASK_COMPLETED);
    handler({ metadata: { approved: false, title: 'Failed task', error: 'timeout' } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Error'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('sends message on PR_MERGED event', () => {
    const handler = getHandler(EVENT_TYPES.PR_MERGED);
    handler({ metadata: { prNumber: 10, repo: 'user/repo' } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('blocks PR_CREATED in minimal mode', () => {
    const handler = getHandler(EVENT_TYPES.PR_CREATED);
    handler({ metadata: { prNumber: 10 } });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('allows PR_CREATED in verbose mode', () => {
    config.telegramVerbosity = 'verbose';
    const handler = getHandler(EVENT_TYPES.PR_CREATED);
    handler({ metadata: { prNumber: 10, branchName: 'feat/x' } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('blocks REVIEW_CYCLE_END in minimal mode', () => {
    const handler = getHandler(EVENT_TYPES.REVIEW_CYCLE_END);
    handler({ metadata: { cycle: 1 } });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('allows REVIEW_CYCLE_END in verbose mode', () => {
    config.telegramVerbosity = 'verbose';
    const handler = getHandler(EVENT_TYPES.REVIEW_CYCLE_END);
    handler({ metadata: { cycle: 1, maxCycles: 3, prNumber: 5, verdict: 'APPROVED' } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('sends fix done notification only in verbose mode with fixing=true', () => {
    const handler = getHandler(EVENT_TYPES.AGENT_CODER_DONE);

    // Minimal mode — should NOT send
    handler({ metadata: { fixing: true, cycle: 1 } });
    expect(mockSendMessage).not.toHaveBeenCalled();

    // Verbose mode — should send
    config.telegramVerbosity = 'verbose';
    handler({ metadata: { fixing: true, cycle: 1 } });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('does NOT send fix done if fixing is false', () => {
    config.telegramVerbosity = 'verbose';
    const handler = getHandler(EVENT_TYPES.AGENT_CODER_DONE);
    handler({ metadata: { fixing: false, cycle: 1 } });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('sends message on CLI_RECOVERED event', () => {
    const handler = getHandler(EVENT_TYPES.CLI_RECOVERED);
    handler({ metadata: { cli: 'claude', downtimeMinutes: 10, taskTitle: 'Add login' } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('CLI recuperado'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('sends message on CLI_RECOVERED without task title', () => {
    const handler = getHandler(EVENT_TYPES.CLI_RECOVERED);
    handler({ metadata: { cli: 'codex', downtimeMinutes: 5 } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('codex'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('sends message on ALL_CLIS_RATE_LIMITED event', () => {
    const handler = getHandler(EVENT_TYPES.ALL_CLIS_RATE_LIMITED);
    handler({ metadata: { clis: ['claude', 'codex'] } });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Todos los CLIs en cooldown'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('registers listeners for CLI_RECOVERED and ALL_CLIS_RATE_LIMITED', () => {
    const registeredEvents = eventBus.on.mock.calls.map(c => c[0]);
    expect(registeredEvents).toContain(EVENT_TYPES.CLI_RECOVERED);
    expect(registeredEvents).toContain(EVENT_TYPES.ALL_CLIS_RATE_LIMITED);
  });

  it('registers listeners for BUDGET_WARNING and BUDGET_EXCEEDED', () => {
    const registeredEvents = eventBus.on.mock.calls.map(c => c[0]);
    expect(registeredEvents).toContain(EVENT_TYPES.BUDGET_WARNING);
    expect(registeredEvents).toContain(EVENT_TYPES.BUDGET_EXCEEDED);
  });

  it('sends budget warning notification in minimal mode', () => {
    const handler = getHandler(EVENT_TYPES.BUDGET_WARNING);
    handler({
      metadata: {
        dailySpent: 8.0,
        dailyBudget: 10,
        weeklySpent: 20.0,
        weeklyBudget: 50,
        percentDaily: 80,
        percentWeekly: 40,
      },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Alerta de budget'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('sends budget exceeded notification in minimal mode', () => {
    const handler = getHandler(EVENT_TYPES.BUDGET_EXCEEDED);
    handler({
      metadata: {
        dailySpent: 10.5,
        dailyBudget: 10,
        weeklySpent: 10.5,
        weeklyBudget: 50,
      },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Budget superado'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  it('shouldNotify allows BUDGET_WARNING and BUDGET_EXCEEDED in both modes', () => {
    expect(shouldNotify(EVENT_TYPES.BUDGET_WARNING)).toBe(true);
    expect(shouldNotify(EVENT_TYPES.BUDGET_EXCEEDED)).toBe(true);
  });
});
