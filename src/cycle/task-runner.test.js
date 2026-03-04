import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all external dependencies before imports
vi.mock('../agents/planner.js', () => ({
  pickNextTask: vi.fn(),
}));

vi.mock('../agents/coder.js', () => ({
  implementTask: vi.fn(),
}));

vi.mock('./review-loop.js', () => ({
  reviewLoop: vi.fn(),
}));

vi.mock('../agents/base-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../skills/github-mcp/src/gh-cli.js', () => ({
  runGh: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    maxReviewCycles: 3,
    autoMerge: true,
    cliPlanner: 'claude',
    cliCoder: 'claude',
    cliReviewer: 'claude',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    logStep: vi.fn(),
    taskHeader: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: vi.fn().mockReturnValue({}),
    emitAgentEvent: vi.fn().mockReturnValue({}),
  },
  EVENT_TYPES: {
    AGENT_STATE_CHANGE: 'agent:state-change',
    TASK_STARTED: 'task:started',
    TASK_COMPLETED: 'task:completed',
    REVIEW_CYCLE: 'review:cycle',
    REVIEW_CYCLE_START: 'review:cycle:start',
    REVIEW_CYCLE_END: 'review:cycle:end',
    PR_CREATED: 'pr:created',
    PR_MERGED: 'pr:merged',
    COST_UPDATED: 'cost:updated',
    MODEL_SELECTED: 'model:selected',
    COMPLEXITY_CLASSIFIED: 'complexity:classified',
    TASK_CLASSIFIED: 'task:classified',
    AGENT_PLANNER_WORKING: 'agent:planner:working',
    AGENT_PLANNER_DONE: 'agent:planner:done',
    AGENT_PLANNER_IDLE: 'agent:planner:idle',
    AGENT_CODER_WORKING: 'agent:coder:working',
    AGENT_CODER_DONE: 'agent:coder:done',
    AGENT_CODER_IDLE: 'agent:coder:idle',
    AGENT_REVIEWER_WORKING: 'agent:reviewer:working',
    AGENT_REVIEWER_DONE: 'agent:reviewer:done',
    AGENT_REVIEWER_IDLE: 'agent:reviewer:idle',
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
  PHASES: {
    IDLE: 'idle',
    PLANNING: 'planning',
    CODING: 'coding',
    ANALYZING: 'analyzing',
    REVIEWING: 'reviewing',
    MERGING: 'merging',
  },
  DASHBOARD_AGENT_STATES: {
    IDLE: 'idle',
    WALKING: 'walking',
    WORKING: 'working',
    DONE: 'done',
  },
  EXECUTION_STATES: {
    STOPPED: 'stopped',
    RUNNING: 'running',
    PAUSED: 'paused',
  },
}));

vi.mock('../state/checkpoint-manager.js', () => ({
  checkpointManager: {
    setFlowContext: vi.fn(),
    clearFlowContext: vi.fn(),
  },
}));

import { runTask } from './task-runner.js';
import { pickNextTask } from '../agents/planner.js';
import { implementTask } from '../agents/coder.js';
import { reviewLoop } from './review-loop.js';
import { eventBus } from '../events/event-bus.js';
import { komodoState } from '../state/komodo-state.js';

describe('task-runner events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits task:started and agent events for a successful task', async () => {
    pickNextTask.mockResolvedValue({
      success: true,
      task: {
        taskId: 'task-123',
        title: 'Test task',
        branchName: 'feature/test',
        repoUrl: 'https://github.com/owner/repo',
      },
    });

    implementTask.mockResolvedValue({
      success: true,
      pr: { prNumber: 42 },
    });

    reviewLoop.mockResolvedValue({
      approved: true,
      cycles: 1,
      finalReview: { verdict: 'APPROVED' },
    });

    await runTask('proj-1');

    // Planner events
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('PLANNER', 'working');
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('PLANNER', 'done');
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('PLANNER', 'idle');

    // task:started
    expect(eventBus.emitEvent).toHaveBeenCalledWith('task:started', expect.objectContaining({
      metadata: expect.objectContaining({ taskId: 'task-123' }),
    }));

    // Coder events
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('CODER', 'working', { taskId: 'task-123' });
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('CODER', 'done');
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('CODER', 'idle');

    // Reviewer events
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('REVIEWER', 'working', { prNumber: 42 });
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('REVIEWER', 'done');
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('REVIEWER', 'idle');

    // task:completed
    expect(eventBus.emitEvent).toHaveBeenCalledWith('task:completed', expect.objectContaining({
      metadata: expect.objectContaining({
        taskId: 'task-123',
        approved: true,
      }),
    }));
  });

  it('updates KomodoState phase at each step', async () => {
    pickNextTask.mockResolvedValue({
      success: true,
      task: {
        taskId: 'task-456',
        title: 'Phase test',
        branchName: 'feature/phase',
        repoUrl: 'https://github.com/owner/repo',
      },
    });

    implementTask.mockResolvedValue({
      success: true,
      pr: { prNumber: 10 },
    });

    reviewLoop.mockResolvedValue({
      approved: true,
      cycles: 1,
      finalReview: { verdict: 'APPROVED' },
    });

    await runTask('proj-1');

    const phaseCalls = komodoState.updatePhase.mock.calls.map(c => c[0]);
    expect(phaseCalls).toContain('planning');
    expect(phaseCalls).toContain('coding');
    expect(phaseCalls).toContain('reviewing');
    expect(phaseCalls).toContain('merging');
    expect(phaseCalls).toContain('idle');
  });

  it('emits agent state changes for planner even when no task found', async () => {
    pickNextTask.mockResolvedValue({
      success: true,
      task: null,
    });

    await runTask('proj-1');

    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('PLANNER', 'working');
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('PLANNER', 'done');
    expect(eventBus.emitAgentEvent).toHaveBeenCalledWith('PLANNER', 'idle');
  });

  it('does not crash when no listeners are attached (fire and forget)', async () => {
    pickNextTask.mockResolvedValue({
      success: true,
      task: {
        taskId: 'task-ff',
        title: 'Fire forget',
        branchName: 'feature/ff',
        repoUrl: 'https://github.com/owner/repo',
      },
    });

    implementTask.mockResolvedValue({
      success: true,
      pr: { prNumber: 1 },
    });

    reviewLoop.mockResolvedValue({
      approved: true,
      cycles: 1,
      finalReview: { verdict: 'APPROVED' },
    });

    // No listeners — should not throw
    await expect(runTask('proj-1')).resolves.toBeDefined();
  });
});
