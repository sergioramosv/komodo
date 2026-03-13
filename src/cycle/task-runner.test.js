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
    startSpinner: vi.fn(),
    stopSpinner: vi.fn(),
    sonarSummary: vi.fn(),
    debug: vi.fn(),
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
    AGENT_FALLBACK: 'agent:fallback',
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
    sonarAnalysis: null,
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

vi.mock('../sonar/analyzer.js', () => ({
  analyzeSonar: vi.fn().mockResolvedValue({ success: false, skipped: true }),
}));

vi.mock('../triage/complexity-classifier.js', () => ({
  classifyAndEmit: vi.fn().mockReturnValue({ level: 'standard' }),
}));

vi.mock('../triage/model-selector.js', () => ({
  selectModel: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../triage/task-decomposer.js', () => ({
  shouldDecompose: vi.fn().mockReturnValue({ shouldDecompose: false, reasons: [] }),
  decomposeTask: vi.fn(),
}));

vi.mock('../agents/fallback-manager.js', () => ({
  fallbackManager: {
    isEnabled: vi.fn().mockReturnValue(false),
    isRateLimited: vi.fn().mockReturnValue(false),
    getAvailableFallbackCli: vi.fn().mockReturnValue(null),
    resolveEffectiveCli: vi.fn((cli) => ({ cli, isFallback: false })),
    markRateLimited: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('../estimation/budget-strategy.js', () => ({
  selectTaskStrategy: vi.fn().mockReturnValue({ recommendation: 'green', maxDevPoints: Infinity, modelTier: null }),
  shouldPauseForForecast: vi.fn().mockReturnValue(false),
  isTaskAllowedByStrategy: vi.fn().mockReturnValue(true),
  applyForecastModelOverride: vi.fn((_forecast, { coderModel, reviewerModel }) => ({ coderModel, reviewerModel })),
}));

vi.mock('../intelligence/cross-project-intelligence.js', () => ({
  applyGlobalAntiPatternsToProject: vi.fn().mockResolvedValue({ applied: 0 }),
  getGlobalInsights: vi.fn().mockResolvedValue(''),
}));

import { runTask } from './task-runner.js';
import { pickNextTask } from '../agents/planner.js';
import { implementTask } from '../agents/coder.js';
import { reviewLoop } from './review-loop.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState } from '../state/komodo-state.js';
import { fallbackManager } from '../agents/fallback-manager.js';
import { config } from '../config.js';
import { applyGlobalAntiPatternsToProject, getGlobalInsights } from '../intelligence/cross-project-intelligence.js';

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

describe('task-runner fallback retry', () => {
  const taskSpec = {
    taskId: 'task-fb',
    title: 'Fallback test',
    branchName: 'feature/fallback',
    repoUrl: 'https://github.com/owner/repo',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: planner returns a valid task
    pickNextTask.mockResolvedValue({ success: true, task: taskSpec });
  });

  it('retries with fallback CLI when coder fails and CLI is rate-limited', async () => {
    // First call fails, second (fallback) succeeds
    implementTask
      .mockResolvedValueOnce({ success: false, error: 'rate limited' })
      .mockResolvedValueOnce({ success: true, pr: { prNumber: 99 } });

    fallbackManager.isEnabled.mockReturnValue(true);
    fallbackManager.isRateLimited.mockReturnValue(true);
    fallbackManager.getAvailableFallbackCli.mockReturnValue('codex');

    reviewLoop.mockResolvedValue({ approved: true, cycles: 1, finalReview: { verdict: 'APPROVED' } });

    const result = await runTask('proj-1');

    // Coder was called twice (original + fallback)
    expect(implementTask).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.prNumber).toBe(99);
  });

  it('fails when fallback CLI also hits rate limit', async () => {
    // Both calls fail
    implementTask
      .mockResolvedValueOnce({ success: false, error: 'rate limited' })
      .mockResolvedValueOnce({ success: false, error: 'fallback also rate limited' });

    fallbackManager.isEnabled.mockReturnValue(true);
    // isRateLimited returns true for both original and fallback
    fallbackManager.isRateLimited.mockReturnValue(true);
    fallbackManager.getAvailableFallbackCli.mockReturnValue('codex');

    const result = await runTask('proj-1');

    expect(implementTask).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
  });

  it('does not emit AGENT_FALLBACK directly (resolveEffectiveCli handles it)', async () => {
    implementTask
      .mockResolvedValueOnce({ success: false, error: 'rate limited' })
      .mockResolvedValueOnce({ success: true, pr: { prNumber: 50 } });

    fallbackManager.isEnabled.mockReturnValue(true);
    fallbackManager.isRateLimited.mockReturnValue(true);
    fallbackManager.getAvailableFallbackCli.mockReturnValue('codex');

    reviewLoop.mockResolvedValue({ approved: true, cycles: 1, finalReview: { verdict: 'APPROVED' } });

    await runTask('proj-1');

    // task-runner should NOT emit AGENT_FALLBACK directly — that's resolveEffectiveCli's job
    const fallbackCalls = eventBus.emitEvent.mock.calls.filter(
      ([type]) => type === EVENT_TYPES.AGENT_FALLBACK
    );
    expect(fallbackCalls).toHaveLength(0);
  });
});

describe('task-runner cross-project intelligence', () => {
  const taskSpec = {
    taskId: 'task-cpi',
    title: 'Cross-project test task',
    branchName: 'feature/cpi',
    repoUrl: 'https://github.com/owner/repo',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pickNextTask.mockResolvedValue({ success: true, task: taskSpec });
    implementTask.mockResolvedValue({ success: true, pr: { prNumber: 77 } });
    reviewLoop.mockResolvedValue({ approved: true, cycles: 1, finalReview: { verdict: 'APPROVED' } });
  });

  it('calls applyGlobalAntiPatternsToProject with projectId on each task run', async () => {
    await runTask('proj-cpi');
    expect(applyGlobalAntiPatternsToProject).toHaveBeenCalledWith('proj-cpi');
  });

  it('calls getGlobalInsights with task title and acceptanceCriteria', async () => {
    pickNextTask.mockResolvedValue({
      success: true,
      task: {
        ...taskSpec,
        acceptanceCriteria: ['validate input', 'return 200 on success'],
      },
    });

    await runTask('proj-cpi');

    expect(getGlobalInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cross-project test task',
        acceptanceCriteria: ['validate input', 'return 200 on success'],
      }),
    );
  });

  it('completes task successfully even when applyGlobalAntiPatternsToProject resolves with applied: 0', async () => {
    applyGlobalAntiPatternsToProject.mockResolvedValue({ applied: 0 });
    const result = await runTask('proj-cpi');
    expect(result.success).toBe(true);
  });

  it('completes task successfully even when getGlobalInsights returns empty string', async () => {
    getGlobalInsights.mockResolvedValue('');
    const result = await runTask('proj-cpi');
    expect(result.success).toBe(true);
  });
});
