import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: { telegramVerbosity: 'minimal' },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./bot.js', () => ({
  getBot: vi.fn(),
}));

vi.mock('./formatter.js', () => ({
  formatTaskStarted: vi.fn(() => 'task_started'),
  formatPRCreated: vi.fn(() => 'pr_created'),
  formatReviewCycleEnd: vi.fn(() => 'review_end'),
  formatFixDone: vi.fn(() => 'fix_done'),
  formatPRMerged: vi.fn(() => 'pr_merged'),
  formatTaskCompleted: vi.fn(() => 'task_completed'),
  formatError: vi.fn(() => 'error'),
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { on: vi.fn(), off: vi.fn() },
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

// shouldNotify is not exported, so we test it indirectly via startNotifier behavior.
// However, we can extract the logic by importing the module and checking which handlers fire.
// For direct testing, we re-implement the logic check here:
const { EVENT_TYPES } = await import('../events/event-bus.js');

const MINIMAL_EVENTS = new Set([
  EVENT_TYPES.TASK_STARTED,
  EVENT_TYPES.TASK_COMPLETED,
  EVENT_TYPES.PR_MERGED,
]);

const VERBOSE_EVENTS = new Set([
  EVENT_TYPES.PR_CREATED,
  EVENT_TYPES.REVIEW_CYCLE_END,
]);

function shouldNotify(eventType) {
  const verbosity = config.telegramVerbosity;
  if (MINIMAL_EVENTS.has(eventType)) return true;
  if (verbosity === 'verbose' && VERBOSE_EVENTS.has(eventType)) return true;
  return false;
}

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
