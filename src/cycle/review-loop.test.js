import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../agents/reviewer.js', () => ({
  reviewPR: vi.fn(),
}));

vi.mock('../agents/coder.js', () => ({
  fixReviewIssues: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    maxReviewCycles: 3,
    smartModelRouting: false,
    smartModelRoutingEscalationThreshold: 7,
  },
}));

vi.mock('../triage/smart-model-router.js', () => ({
  getEscalationModel: vi.fn((cliType, currentModel) => currentModel),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: vi.fn().mockReturnValue({}),
    emitAgentEvent: vi.fn().mockReturnValue({}),
  },
  EVENT_TYPES: {
    AGENT_STATE_CHANGE: 'agent:state-change',
    REVIEW_CYCLE: 'review:cycle',
    REVIEW_CYCLE_START: 'review:cycle:start',
    REVIEW_CYCLE_END: 'review:cycle:end',
    COST_UPDATED: 'cost:updated',
    AGENT_REVIEWER_WORKING: 'agent:reviewer:working',
    AGENT_REVIEWER_DONE: 'agent:reviewer:done',
    AGENT_REVIEWER_IDLE: 'agent:reviewer:idle',
    AGENT_CODER_WORKING: 'agent:coder:working',
    AGENT_CODER_DONE: 'agent:coder:done',
    AGENT_CODER_IDLE: 'agent:coder:idle',
    MODEL_ESCALATED: 'triage:model-escalated',
  },
  AGENT_STATES: {
    IDLE: 'idle',
    WORKING: 'working',
    WAITING: 'waiting',
  },
}));

vi.mock('../state/komodo-state.js', () => ({
  komodoState: {
    updatePhase: vi.fn(),
    updateAgent: vi.fn().mockReturnValue({}),
    isPauseRequested: vi.fn().mockReturnValue(false),
  },
  DASHBOARD_AGENT_STATES: {
    IDLE: 'idle',
    WALKING: 'walking',
    WORKING: 'working',
    DONE: 'done',
  },
}));

vi.mock('../state/checkpoint-manager.js', () => ({
  checkpointManager: {
    setFlowContext: vi.fn(),
    clearFlowContext: vi.fn(),
  },
}));

vi.mock('./review-feedback-recorder.js', () => ({
  recordReviewIssues: vi.fn().mockResolvedValue(),
  recordAvoidedPatterns: vi.fn().mockResolvedValue(),
}));

import { reviewLoop } from './review-loop.js';
import { reviewPR } from '../agents/reviewer.js';
import { fixReviewIssues } from '../agents/coder.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState } from '../state/komodo-state.js';
import { config } from '../config.js';
import { getEscalationModel } from '../triage/smart-model-router.js';

const baseOptions = {
  prNumber: 42,
  repo: 'owner/repo',
  taskSpec: { taskId: 'task-1', title: 'Test' },
  cwd: '/tmp',
};

describe('review-loop events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits review:cycle:start and review:cycle:end with APPROVED verdict', async () => {
    reviewPR.mockResolvedValue({
      success: true,
      review: { verdict: 'APPROVED' },
    });

    await reviewLoop(baseOptions);

    // review:cycle:start
    expect(eventBus.emitEvent).toHaveBeenCalledWith('review:cycle:start', expect.objectContaining({
      agentName: 'REVIEWER',
      metadata: expect.objectContaining({ cycle: 1, prNumber: 42 }),
    }));

    // review:cycle:end with verdict
    expect(eventBus.emitEvent).toHaveBeenCalledWith('review:cycle:end', expect.objectContaining({
      agentName: 'REVIEWER',
      metadata: expect.objectContaining({ verdict: 'APPROVED', cycle: 1 }),
    }));
  });

  it('emits review:cycle:end with REQUEST_CHANGES when max cycles reached', async () => {
    reviewPR.mockResolvedValue({
      success: true,
      review: { verdict: 'REQUEST_CHANGES', issues: ['bug'] },
    });

    fixReviewIssues.mockResolvedValue({ success: true });

    const result = await reviewLoop(baseOptions);

    expect(result.approved).toBe(false);

    // Should have emitted review:cycle:end for each cycle
    const cycleEndCalls = eventBus.emitEvent.mock.calls.filter(
      c => c[0] === 'review:cycle:end'
    );
    expect(cycleEndCalls.length).toBeGreaterThanOrEqual(1);

    // Last cycle should have REQUEST_CHANGES verdict
    const lastEnd = cycleEndCalls[cycleEndCalls.length - 1];
    expect(lastEnd[1].metadata.verdict).toBe('REQUEST_CHANGES');
  });

  it('emits agent:reviewer:working and agent:reviewer:done per cycle', async () => {
    reviewPR.mockResolvedValue({
      success: true,
      review: { verdict: 'APPROVED' },
    });

    await reviewLoop(baseOptions);

    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('REVIEWER', 'working', { cycle: 1 });
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('REVIEWER', 'done');
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('REVIEWER', 'idle');
  });

  it('emits agent:coder:working/done/idle when coder fixes issues', async () => {
    reviewPR
      .mockResolvedValueOnce({
        success: true,
        review: { verdict: 'REQUEST_CHANGES', issues: ['fix this'] },
      })
      .mockResolvedValueOnce({
        success: true,
        review: { verdict: 'APPROVED' },
      });

    fixReviewIssues.mockResolvedValue({ success: true });

    await reviewLoop(baseOptions);

    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('CODER', 'working', expect.objectContaining({ fixing: true }));
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('CODER', 'done', expect.objectContaining({ fixing: true }));
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('CODER', 'idle');
  });

  it('updates KomodoState for reviewer agent status', async () => {
    reviewPR.mockResolvedValue({
      success: true,
      review: { verdict: 'APPROVED' },
    });

    await reviewLoop(baseOptions);

    expect(komodoState.updateAgent).toHaveBeenCalledWith('REVIEWER', { status: 'working' });
  });

  it('does not crash when no listeners exist (fire and forget)', async () => {
    reviewPR.mockResolvedValue({
      success: true,
      review: { verdict: 'APPROVED' },
    });

    await expect(reviewLoop(baseOptions)).resolves.toBeDefined();
  });
});

describe('review-loop auto-escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.smartModelRouting = false;
    config.smartModelRoutingEscalationThreshold = 7;
    getEscalationModel.mockImplementation((cliType, model) => model);
  });

  const escalationOptions = {
    ...baseOptions,
    coderModel: 'sonnet',
    coderCli: 'claude',
  };

  it('does NOT escalate when smartModelRouting is disabled', async () => {
    config.smartModelRouting = false;

    reviewPR
      .mockResolvedValueOnce({ success: true, review: { verdict: 'REQUEST_CHANGES', issues: [], score: 4 } })
      .mockResolvedValueOnce({ success: true, review: { verdict: 'APPROVED', score: 9 } });
    fixReviewIssues.mockResolvedValue({ success: true });

    await reviewLoop(escalationOptions);

    expect(getEscalationModel).not.toHaveBeenCalled();
  });

  it('does NOT escalate when score >= threshold', async () => {
    config.smartModelRouting = true;

    reviewPR
      .mockResolvedValueOnce({ success: true, review: { verdict: 'REQUEST_CHANGES', issues: [], score: 8 } })
      .mockResolvedValueOnce({ success: true, review: { verdict: 'APPROVED', score: 9 } });
    fixReviewIssues.mockResolvedValue({ success: true });
    getEscalationModel.mockReturnValue('sonnet');

    await reviewLoop(escalationOptions);

    // score 8 >= threshold 7, so escalation check is skipped
    expect(getEscalationModel).not.toHaveBeenCalled();
  });

  it('escalates to next model when score < threshold', async () => {
    config.smartModelRouting = true;
    getEscalationModel.mockReturnValue('opus'); // sonnet → opus

    reviewPR
      .mockResolvedValueOnce({ success: true, review: { verdict: 'REQUEST_CHANGES', issues: [], score: 4 } })
      .mockResolvedValueOnce({ success: true, review: { verdict: 'APPROVED', score: 9 } });
    fixReviewIssues.mockResolvedValue({ success: true });

    await reviewLoop(escalationOptions);

    expect(getEscalationModel).toHaveBeenCalledWith('claude', 'sonnet');
    // Coder fix should have used the escalated model
    expect(fixReviewIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ model: 'opus' }),
    );
  });

  it('emits MODEL_ESCALATED event when escalation occurs', async () => {
    config.smartModelRouting = true;
    getEscalationModel.mockReturnValue('opus');

    reviewPR
      .mockResolvedValueOnce({ success: true, review: { verdict: 'REQUEST_CHANGES', issues: [], score: 3 } })
      .mockResolvedValueOnce({ success: true, review: { verdict: 'APPROVED', score: 9 } });
    fixReviewIssues.mockResolvedValue({ success: true });

    await reviewLoop(escalationOptions);

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'triage:model-escalated',
      expect.objectContaining({
        metadata: expect.objectContaining({
          agentRole: 'CODER',
          fromModel: 'sonnet',
          toModel: 'opus',
          triggerScore: 3,
        }),
      }),
    );
  });

  it('does NOT escalate when getEscalationModel returns the same model (already at top)', async () => {
    config.smartModelRouting = true;
    getEscalationModel.mockReturnValue('opus'); // same as current

    reviewPR
      .mockResolvedValueOnce({ success: true, review: { verdict: 'REQUEST_CHANGES', issues: [], score: 2 } })
      .mockResolvedValueOnce({ success: true, review: { verdict: 'APPROVED', score: 9 } });
    fixReviewIssues.mockResolvedValue({ success: true });

    // Start with opus (already at top of chain)
    await reviewLoop({ ...escalationOptions, coderModel: 'opus' });

    // getEscalationModel called, but returns same model → no MODEL_ESCALATED event
    expect(eventBus.emitEvent).not.toHaveBeenCalledWith(
      'triage:model-escalated',
      expect.anything(),
    );
  });

  it('returns finalCoderModel reflecting any escalation', async () => {
    config.smartModelRouting = true;
    getEscalationModel.mockReturnValue('opus');

    reviewPR
      .mockResolvedValueOnce({ success: true, review: { verdict: 'REQUEST_CHANGES', issues: [], score: 4 } })
      .mockResolvedValueOnce({ success: true, review: { verdict: 'APPROVED', score: 9 } });
    fixReviewIssues.mockResolvedValue({ success: true });

    const result = await reviewLoop(escalationOptions);

    expect(result.finalCoderModel).toBe('opus');
  });

  it('returns finalCoderModel equal to original coderModel when no escalation', async () => {
    config.smartModelRouting = false;

    reviewPR.mockResolvedValue({ success: true, review: { verdict: 'APPROVED', score: 9 } });

    const result = await reviewLoop(escalationOptions);

    expect(result.finalCoderModel).toBe('sonnet');
  });
});
