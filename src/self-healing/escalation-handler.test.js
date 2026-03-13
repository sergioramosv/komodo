import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmitEvent = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();
const mockSetExecutionState = vi.fn();

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: mockEmitEvent,
    on: mockOn,
    removeListener: mockRemoveListener,
  },
  EVENT_TYPES: {
    SELF_HEAL_EXHAUSTED: 'self-heal:exhausted',
    AUTONOMY_APPROVAL_REQUESTED: 'autonomy:approval:requested',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../state/komodo-state.js', () => ({
  komodoState: { setExecutionState: mockSetExecutionState },
  EXECUTION_STATES: { PAUSED: 'paused', AWAITING_APPROVAL: 'awaiting_approval' },
}));

const mockGetActiveLevel = vi.fn();
vi.mock('../autonomy/autonomy-engine.js', () => ({
  getActiveLevel: mockGetActiveLevel,
  AUTONOMY_LEVELS: {
    SUPERVISED: 'supervised',
    SEMI_AUTONOMOUS: 'semi-autonomous',
    AUTONOMOUS: 'autonomous',
    GUARDIAN: 'guardian',
  },
}));

// Import after mocks are set up
const { escalationHandler } = await import('./escalation-handler.js');

describe('escalationHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    escalationHandler._handler = null;
  });

  describe('start()', () => {
    it('registers a listener on SELF_HEAL_EXHAUSTED', () => {
      escalationHandler.start();
      expect(mockOn).toHaveBeenCalledWith('self-heal:exhausted', expect.any(Function));
    });
  });

  describe('stop()', () => {
    it('removes the listener and clears the handler', () => {
      escalationHandler.start();
      escalationHandler.stop();
      expect(mockRemoveListener).toHaveBeenCalledWith('self-heal:exhausted', expect.any(Function));
      expect(escalationHandler._handler).toBeNull();
    });

    it('is a no-op if not started', () => {
      escalationHandler.stop();
      expect(mockRemoveListener).not.toHaveBeenCalled();
    });
  });

  describe('handler behaviour by autonomy level', () => {
    const payload = {
      metadata: { taskId: 'task-abc', errorMessage: 'timeout', attempts: 2 },
    };

    function triggerHandler() {
      escalationHandler.start();
      // Get the registered handler and invoke it directly
      const handler = mockOn.mock.calls[0][1];
      handler(payload);
    }

    it('SUPERVISED: sets state to AWAITING_APPROVAL and emits approval request', () => {
      mockGetActiveLevel.mockReturnValue('supervised');
      triggerHandler();
      expect(mockSetExecutionState).toHaveBeenCalledWith('awaiting_approval');
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'autonomy:approval:requested',
        expect.objectContaining({
          metadata: expect.objectContaining({
            step: 'self-heal:exhausted',
            taskId: 'task-abc',
          }),
        }),
      );
    });

    it('SEMI_AUTONOMOUS: sets state to AWAITING_APPROVAL and emits approval request', () => {
      mockGetActiveLevel.mockReturnValue('semi-autonomous');
      triggerHandler();
      expect(mockSetExecutionState).toHaveBeenCalledWith('awaiting_approval');
      expect(mockEmitEvent).toHaveBeenCalledWith('autonomy:approval:requested', expect.any(Object));
    });

    it('AUTONOMOUS: sets state to PAUSED, does not emit approval request', () => {
      mockGetActiveLevel.mockReturnValue('autonomous');
      triggerHandler();
      expect(mockSetExecutionState).toHaveBeenCalledWith('paused');
      expect(mockEmitEvent).not.toHaveBeenCalledWith('autonomy:approval:requested', expect.anything());
    });

    it('GUARDIAN: sets state to PAUSED, does not emit approval request', () => {
      mockGetActiveLevel.mockReturnValue('guardian');
      triggerHandler();
      expect(mockSetExecutionState).toHaveBeenCalledWith('paused');
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('handles missing metadata fields gracefully', () => {
      mockGetActiveLevel.mockReturnValue('autonomous');
      escalationHandler.start();
      const handler = mockOn.mock.calls[0][1];
      expect(() => handler({ metadata: {} })).not.toThrow();
      expect(mockSetExecutionState).toHaveBeenCalledWith('paused');
    });
  });
});
