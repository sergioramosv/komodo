import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    approvalTimeoutMinutes: 5,
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    AUTONOMY_APPROVAL_REQUESTED: 'AUTONOMY_APPROVAL_REQUESTED',
    AUTONOMY_AUTO_APPROVED: 'AUTONOMY_AUTO_APPROVED',
    AUTONOMY_APPROVED: 'AUTONOMY_APPROVED',
    AUTONOMY_REJECTED: 'AUTONOMY_REJECTED',
    AUTONOMY_TIMED_OUT: 'AUTONOMY_TIMED_OUT',
  },
}));

vi.mock('../state/komodo-state.js', () => ({
  komodoState: { setExecutionState: vi.fn() },
  EXECUTION_STATES: { RUNNING: 'running', AWAITING_APPROVAL: 'awaiting_approval' },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { waitForApproval } from './approval-gate.js';

describe('approval-gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('waitForApproval — non-TTY (daemon/CI)', () => {
    const originalIsTTY = process.stdin.isTTY;

    beforeEach(() => {
      process.stdin.isTTY = false;
    });

    afterEach(() => {
      process.stdin.isTTY = originalIsTTY;
    });

    it('auto-approves immediately in non-TTY mode', async () => {
      const result = await waitForApproval({ step: 'after_planning', description: 'Test' });

      expect(result).toEqual({ approved: true, timedOut: false });
    });

    it('emits AUTONOMY_APPROVAL_REQUESTED event', async () => {
      await waitForApproval({ step: 'after_planning' });

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.AUTONOMY_APPROVAL_REQUESTED,
        expect.objectContaining({
          metadata: expect.objectContaining({ step: 'after_planning' }),
        }),
      );
    });

    it('emits AUTONOMY_AUTO_APPROVED with reason non-tty', async () => {
      await waitForApproval({ step: 'before_merge', description: 'Merge PR' });

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.AUTONOMY_AUTO_APPROVED,
        expect.objectContaining({
          metadata: expect.objectContaining({ step: 'before_merge', reason: 'non-tty' }),
        }),
      );
    });

    it('sets execution state to AWAITING_APPROVAL then back to RUNNING', async () => {
      await waitForApproval({ step: 'after_review' });

      expect(komodoState.setExecutionState).toHaveBeenCalledWith(EXECUTION_STATES.AWAITING_APPROVAL);
      expect(komodoState.setExecutionState).toHaveBeenCalledWith(EXECUTION_STATES.RUNNING);
    });

    it('passes metadata through to events', async () => {
      await waitForApproval({
        step: 'before_merge',
        description: 'PR #42',
        metadata: { prNumber: 42 },
      });

      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        EVENT_TYPES.AUTONOMY_APPROVAL_REQUESTED,
        expect.objectContaining({
          metadata: expect.objectContaining({ prNumber: 42, step: 'before_merge' }),
        }),
      );
    });
  });
});
