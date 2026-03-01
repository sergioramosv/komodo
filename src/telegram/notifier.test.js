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
});
