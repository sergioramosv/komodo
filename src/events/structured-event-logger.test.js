import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock crypto randomUUID
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-1234'),
}));

// Mock firebase
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockOnce = vi.fn();
const mockRef = vi.fn(() => ({
  set: mockSet,
  once: mockOnce,
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getDb: () => ({ ref: mockRef }),
}));

// Mock event-bus
const mockEmitEvent = vi.fn();
vi.mock('./event-bus.js', () => ({
  eventBus: { emitEvent: mockEmitEvent },
  EVENT_TYPES: {
    STRUCTURED_EVENT_LOGGED: 'structured:event:logged',
    TASK_TOKEN_METRICS_UPDATED: 'task:token-metrics:updated',
  },
}));

const {
  createStructuredEvent,
  emitStructuredEvent,
  getTaskEvents,
  getTaskTokenMetrics,
  PHASES,
  ACTIONS,
} = await import('./structured-event-logger.js');

describe('structured-event-logger', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Restore permanent defaults after reset
    mockSet.mockResolvedValue(undefined);
  });

  // ── createStructuredEvent ──────────────────────────────────

  describe('createStructuredEvent', () => {
    it('creates an event with all required fields', () => {
      const event = createStructuredEvent({
        taskId: 'task-123',
        phase: PHASES.CODING,
        agent: 'CODER',
        action: ACTIONS.IMPLEMENT_TASK,
        input: { prompt: 'implement feature X' },
        output: { prNumber: 42, filesChanged: ['src/x.js'] },
        metrics: { tokensUsed: 1500, turnsUsed: 3, durationMs: 8000 },
        context: { branchName: 'feature/x' },
        parentEventId: 'prev-event-id',
      });

      expect(event.id).toBe('mock-uuid-1234');
      expect(event.taskId).toBe('task-123');
      expect(event.phase).toBe('coding');
      expect(event.agent).toBe('CODER');
      expect(event.action).toBe('implement_task');
      expect(event.input).toEqual({ prompt: 'implement feature X' });
      expect(event.output).toEqual({ prNumber: 42, filesChanged: ['src/x.js'] });
      expect(event.metrics.tokensUsed).toBe(1500);
      expect(event.metrics.turnsUsed).toBe(3);
      expect(event.metrics.durationMs).toBe(8000);
      expect(event.context).toEqual({ branchName: 'feature/x' });
      expect(event.parentEventId).toBe('prev-event-id');
      expect(event.timestamp).toBeDefined();
    });

    it('uses defaults for optional fields', () => {
      const event = createStructuredEvent({
        taskId: 'task-456',
        phase: PHASES.PLANNING,
        agent: 'PLANNER',
        action: ACTIONS.PICK_TASK,
      });

      expect(event.input).toEqual({});
      expect(event.output).toEqual({});
      expect(event.metrics.tokensUsed).toBeNull();
      expect(event.metrics.turnsUsed).toBeNull();
      expect(event.metrics.durationMs).toBeNull();
      expect(event.context).toEqual({});
      expect(event.parentEventId).toBeNull();
    });

    it('generates a unique id for each event', async () => {
      const { randomUUID } = await import('crypto');
      randomUUID
        .mockReturnValueOnce('uuid-aaa')
        .mockReturnValueOnce('uuid-bbb');

      const e1 = createStructuredEvent({ taskId: 't1', phase: PHASES.PLANNING, agent: 'PLANNER', action: ACTIONS.PICK_TASK });
      const e2 = createStructuredEvent({ taskId: 't1', phase: PHASES.CODING, agent: 'CODER', action: ACTIONS.IMPLEMENT_TASK });

      expect(e1.id).toBe('uuid-aaa');
      expect(e2.id).toBe('uuid-bbb');
    });

    it('includes iso timestamp', () => {
      const before = Date.now();
      const event = createStructuredEvent({ taskId: 't1', phase: PHASES.PLANNING, agent: 'PLANNER', action: ACTIONS.PICK_TASK });
      const after = Date.now();

      const ts = new Date(event.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  // ── emitStructuredEvent ───────────────────────────────────

  describe('emitStructuredEvent', () => {
    it('persists event to firebase and emits STRUCTURED_EVENT_LOGGED', async () => {
      mockOnce.mockResolvedValueOnce({ val: () => null });
      mockSet.mockResolvedValue(undefined);

      const event = await emitStructuredEvent('proj-1', {
        taskId: 'task-abc',
        phase: PHASES.REVIEWING,
        agent: 'REVIEWER',
        action: ACTIONS.REVIEW_PR,
        output: { approved: true },
      });

      expect(mockRef).toHaveBeenCalledWith(
        `structured-events/proj-1/task-abc/${event.id}`,
      );
      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-abc',
        phase: 'reviewing',
        agent: 'REVIEWER',
        action: 'review_pr',
      }));

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'structured:event:logged',
        expect.objectContaining({
          agentName: 'REVIEWER',
          metadata: expect.objectContaining({
            taskId: 'task-abc',
            phase: 'reviewing',
            action: 'review_pr',
          }),
        }),
      );
    });

    it('emits TASK_TOKEN_METRICS_UPDATED when tokensUsed is provided', async () => {
      // First call: get current metrics (null), second call: set updated metrics
      mockOnce.mockResolvedValueOnce({ val: () => ({ totalTokensUsed: 1000, eventCount: 2 }) });
      mockSet.mockResolvedValue(undefined);

      await emitStructuredEvent('proj-1', {
        taskId: 'task-xyz',
        phase: PHASES.CODING,
        agent: 'CODER',
        action: ACTIONS.IMPLEMENT_TASK,
        metrics: { tokensUsed: 500 },
      });

      const tokenUpdateCall = mockEmitEvent.mock.calls.find(
        call => call[0] === 'task:token-metrics:updated',
      );
      expect(tokenUpdateCall).toBeDefined();
      expect(tokenUpdateCall[1].metadata.totalTokensUsed).toBe(1500);
      expect(tokenUpdateCall[1].metadata.eventCount).toBe(3);
    });

    it('does not emit TASK_TOKEN_METRICS_UPDATED when tokensUsed is null', async () => {
      mockSet.mockResolvedValue(undefined);

      await emitStructuredEvent('proj-1', {
        taskId: 'task-xyz',
        phase: PHASES.PLANNING,
        agent: 'PLANNER',
        action: ACTIONS.PICK_TASK,
      });

      const tokenUpdateCall = mockEmitEvent.mock.calls.find(
        call => call[0] === 'task:token-metrics:updated',
      );
      expect(tokenUpdateCall).toBeUndefined();
    });

    it('builds a traceability chain via parentEventId', async () => {
      mockOnce.mockResolvedValue({ val: () => null });
      mockSet.mockResolvedValue(undefined);

      const e1 = await emitStructuredEvent('proj-1', {
        taskId: 'task-chain',
        phase: PHASES.PLANNING,
        agent: 'PLANNER',
        action: ACTIONS.PICK_TASK,
        parentEventId: null,
      });

      const e2 = await emitStructuredEvent('proj-1', {
        taskId: 'task-chain',
        phase: PHASES.ARCHITECTING,
        agent: 'ARCHITECT',
        action: ACTIONS.ANALYZE_CODEBASE,
        parentEventId: e1.id,
      });

      expect(e2.parentEventId).toBe(e1.id);
    });

    it('continues without throwing when firebase fails', async () => {
      mockSet.mockRejectedValue(new Error('Firebase unavailable'));

      await expect(
        emitStructuredEvent('proj-1', {
          taskId: 'task-fail',
          phase: PHASES.CODING,
          agent: 'CODER',
          action: ACTIONS.IMPLEMENT_TASK,
        }),
      ).resolves.toBeDefined();
    });
  });

  // ── getTaskEvents ─────────────────────────────────────────

  describe('getTaskEvents', () => {
    it('returns events sorted by timestamp', async () => {
      mockOnce.mockResolvedValueOnce({
        val: () => ({
          'id-2': { id: 'id-2', timestamp: '2026-03-13T10:05:00Z', agent: 'CODER' },
          'id-1': { id: 'id-1', timestamp: '2026-03-13T10:00:00Z', agent: 'PLANNER' },
          'id-3': { id: 'id-3', timestamp: '2026-03-13T10:10:00Z', agent: 'REVIEWER' },
        }),
      });

      const events = await getTaskEvents('proj-1', 'task-abc');

      expect(events).toHaveLength(3);
      expect(events[0].agent).toBe('PLANNER');
      expect(events[1].agent).toBe('CODER');
      expect(events[2].agent).toBe('REVIEWER');
    });

    it('returns empty array when task has no events', async () => {
      mockOnce.mockResolvedValueOnce({ val: () => null });

      const events = await getTaskEvents('proj-1', 'task-empty');

      expect(events).toEqual([]);
    });

    it('returns empty array when firebase fails', async () => {
      mockOnce.mockRejectedValueOnce(new Error('Network error'));

      const events = await getTaskEvents('proj-1', 'task-error');

      expect(events).toEqual([]);
    });
  });

  // ── getTaskTokenMetrics ───────────────────────────────────

  describe('getTaskTokenMetrics', () => {
    it('returns cumulative token metrics for a task', async () => {
      mockOnce.mockResolvedValueOnce({
        val: () => ({ totalTokensUsed: 3500, eventCount: 5, lastUpdated: '2026-03-13T10:00:00Z' }),
      });

      const metrics = await getTaskTokenMetrics('proj-1', 'task-abc');

      expect(metrics.totalTokensUsed).toBe(3500);
      expect(metrics.eventCount).toBe(5);
      expect(metrics.lastUpdated).toBe('2026-03-13T10:00:00Z');
    });

    it('returns null when no metrics exist', async () => {
      mockOnce.mockResolvedValueOnce({ val: () => null });

      const metrics = await getTaskTokenMetrics('proj-1', 'task-new');

      expect(metrics).toBeNull();
    });

    it('returns null when firebase fails', async () => {
      mockOnce.mockRejectedValueOnce(new Error('DB error'));

      const metrics = await getTaskTokenMetrics('proj-1', 'task-fail');

      expect(metrics).toBeNull();
    });
  });

  // ── PHASES and ACTIONS constants ──────────────────────────

  describe('constants', () => {
    it('exports all expected PHASES', () => {
      expect(PHASES.PLANNING).toBe('planning');
      expect(PHASES.ARCHITECTING).toBe('architecting');
      expect(PHASES.CODING).toBe('coding');
      expect(PHASES.TESTING).toBe('testing');
      expect(PHASES.SECURITY).toBe('security');
      expect(PHASES.REVIEWING).toBe('reviewing');
    });

    it('exports all expected ACTIONS', () => {
      expect(ACTIONS.PICK_TASK).toBe('pick_task');
      expect(ACTIONS.ANALYZE_CODEBASE).toBe('analyze_codebase');
      expect(ACTIONS.IMPLEMENT_TASK).toBe('implement_task');
      expect(ACTIONS.GENERATE_TESTS).toBe('generate_tests');
      expect(ACTIONS.RUN_TESTS).toBe('run_tests');
      expect(ACTIONS.SECURITY_SCAN).toBe('security_scan');
      expect(ACTIONS.REVIEW_PR).toBe('review_pr');
      expect(ACTIONS.FIX_ISSUES).toBe('fix_issues');
    });
  });
});
