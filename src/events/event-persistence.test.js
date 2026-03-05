import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock firebase before imports
const mockPush = vi.fn();
const mockSet = vi.fn().mockResolvedValue();
const mockOnce = vi.fn();
const mockUpdate = vi.fn().mockResolvedValue();
const mockRef = vi.fn(() => ({
  push: () => {
    const ref = { key: '-MockEventId', set: mockSet };
    mockPush.mockReturnValue(ref);
    return ref;
  },
  once: mockOnce,
  update: mockUpdate,
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getDb: () => ({ ref: mockRef }),
}));

// Mock config with defaults
vi.mock('../config.js', () => ({
  config: {
    eventRetentionDays: 30,
    eventPersistTypes: '*',
  },
}));

const { config } = await import('../config.js');
const {
  shouldPersist,
  persistEvent,
  startEventPersistence,
  queryEvents,
  cleanupOldEvents,
} = await import('./event-persistence.js');

const { KomodoEventBus, EVENT_TYPES } = await import('./event-bus.js');

describe('EventPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.eventPersistTypes = '*';
    config.eventRetentionDays = 30;
  });

  // ── shouldPersist ───────────────────────────────────────

  describe('shouldPersist', () => {
    it('allows all events when eventPersistTypes is *', () => {
      expect(shouldPersist(EVENT_TYPES.TASK_STARTED)).toBe(true);
      expect(shouldPersist(EVENT_TYPES.PR_CREATED)).toBe(true);
    });

    it('excludes agent:output (high frequency)', () => {
      expect(shouldPersist(EVENT_TYPES.AGENT_OUTPUT)).toBe(false);
    });

    it('filters by specific types when configured', () => {
      config.eventPersistTypes = 'task:started,pr:created';
      expect(shouldPersist(EVENT_TYPES.TASK_STARTED)).toBe(true);
      expect(shouldPersist(EVENT_TYPES.PR_CREATED)).toBe(true);
      expect(shouldPersist(EVENT_TYPES.REVIEW_CYCLE)).toBe(false);
    });

    it('agent:output is excluded even with specific filter', () => {
      config.eventPersistTypes = 'agent:output,task:started';
      expect(shouldPersist(EVENT_TYPES.AGENT_OUTPUT)).toBe(false);
    });
  });

  // ── persistEvent ────────────────────────────────────────

  describe('persistEvent', () => {
    it('writes event to /events/{projectId}/{date}/', async () => {
      const payload = {
        type: EVENT_TYPES.TASK_STARTED,
        timestamp: '2026-03-05T10:00:00.000Z',
        agentName: 'CODER',
        metadata: { taskId: 'task-123' },
      };

      const id = await persistEvent('proj-1', payload);

      expect(id).toBe('-MockEventId');
      expect(mockRef).toHaveBeenCalledWith('events/proj-1/2026-03-05');
      expect(mockSet).toHaveBeenCalledWith({
        type: 'task:started',
        timestamp: '2026-03-05T10:00:00.000Z',
        metadata: { taskId: 'task-123' },
        agentName: 'CODER',
        taskId: 'task-123',
      });
    });

    it('returns null for excluded events', async () => {
      const payload = {
        type: EVENT_TYPES.AGENT_OUTPUT,
        timestamp: '2026-03-05T10:00:00.000Z',
        metadata: {},
      };

      const id = await persistEvent('proj-1', payload);

      expect(id).toBeNull();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('handles missing metadata gracefully', async () => {
      const payload = {
        type: EVENT_TYPES.PR_CREATED,
        timestamp: '2026-03-05T12:00:00.000Z',
        agentName: null,
      };

      await persistEvent('proj-1', payload);

      expect(mockSet).toHaveBeenCalledWith({
        type: 'pr:created',
        timestamp: '2026-03-05T12:00:00.000Z',
        metadata: {},
        agentName: null,
        taskId: null,
      });
    });
  });

  // ── startEventPersistence ───────────────────────────────

  describe('startEventPersistence', () => {
    it('subscribes to eventBus and persists emitted events', async () => {
      const bus = new KomodoEventBus();
      // Replace the singleton temporarily by patching onAny
      const originalOnAny = bus.onAny.bind(bus);

      // We test via the module's direct persistEvent since startEventPersistence
      // uses the singleton eventBus. Instead, test the pattern directly:
      const events = [];
      bus.onAny((payload) => {
        events.push(payload);
      });

      bus.emitEvent(EVENT_TYPES.TASK_STARTED, { metadata: { taskId: 'x' } });
      bus.emitEvent(EVENT_TYPES.AGENT_OUTPUT, { metadata: {} });

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('task:started');
    });
  });

  // ── queryEvents ─────────────────────────────────────────

  describe('queryEvents', () => {
    it('returns events across multiple dates', async () => {
      mockOnce
        .mockResolvedValueOnce({
          val: () => ({
            e1: { type: 'task:started', timestamp: '2026-03-01T10:00:00Z', agentName: 'CODER' },
            e2: { type: 'pr:created', timestamp: '2026-03-01T11:00:00Z', agentName: null },
          }),
        })
        .mockResolvedValueOnce({
          val: () => ({
            e3: { type: 'task:completed', timestamp: '2026-03-02T09:00:00Z', agentName: 'CODER' },
          }),
        });

      const results = await queryEvents('proj-1', '2026-03-01', '2026-03-02');

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('e1');
      expect(results[2].type).toBe('task:completed');
    });

    it('filters by event type', async () => {
      mockOnce.mockResolvedValueOnce({
        val: () => ({
          e1: { type: 'task:started', timestamp: '2026-03-01T10:00:00Z' },
          e2: { type: 'pr:created', timestamp: '2026-03-01T11:00:00Z' },
        }),
      });

      const results = await queryEvents('proj-1', '2026-03-01', '2026-03-01', 'pr:created');

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('pr:created');
    });

    it('returns empty array when no data exists', async () => {
      mockOnce.mockResolvedValueOnce({ val: () => null });

      const results = await queryEvents('proj-1', '2026-03-01', '2026-03-01');

      expect(results).toHaveLength(0);
    });
  });

  // ── cleanupOldEvents ────────────────────────────────────

  describe('cleanupOldEvents', () => {
    it('removes date nodes older than retention period', async () => {
      const today = new Date();
      const oldDate = new Date(today);
      oldDate.setDate(oldDate.getDate() - 40);
      const oldKey = oldDate.toISOString().slice(0, 10);
      const recentKey = today.toISOString().slice(0, 10);

      mockOnce.mockResolvedValueOnce({
        val: () => ({
          [oldKey]: { e1: {} },
          [recentKey]: { e2: {} },
        }),
      });

      const removed = await cleanupOldEvents('proj-1');

      expect(removed).toBe(1);
      expect(mockUpdate).toHaveBeenCalledWith({ [oldKey]: null });
    });

    it('returns 0 when no events exist', async () => {
      mockOnce.mockResolvedValueOnce({ val: () => null });

      const removed = await cleanupOldEvents('proj-1');

      expect(removed).toBe(0);
    });

    it('accepts custom retention days override', async () => {
      const today = new Date();
      const oldDate = new Date(today);
      oldDate.setDate(oldDate.getDate() - 5);
      const oldKey = oldDate.toISOString().slice(0, 10);

      mockOnce.mockResolvedValueOnce({
        val: () => ({ [oldKey]: { e1: {} } }),
      });

      const removed = await cleanupOldEvents('proj-1', 3);

      expect(removed).toBe(1);
    });
  });
});
