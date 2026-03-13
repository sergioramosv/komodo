import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    SELF_HEALING_ATTEMPTED: 'self-healing:attempted',
    SELF_HEALING_SUCCEEDED: 'self-healing:succeeded',
    SELF_HEALING_FAILED: 'self-healing:failed',
    SELF_HEAL_RECOVERED: 'self-heal:recovered',
    SELF_HEAL_EXHAUSTED: 'self-heal:exhausted',
  },
}));
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../knowledge/knowledge-graph.js', () => ({
  saveHealingAttempt: vi.fn(),
}));

// Stub all strategies
vi.mock('./strategies/test-failure.js', () => ({
  testFailureStrategy: {
    name: 'test-failure',
    detect: vi.fn(() => false),
    diagnose: vi.fn(() => ({})),
    heal: vi.fn(async () => ({ healed: true, action: 'fix-new-test-failure' })),
  },
}));
vi.mock('./strategies/merge-conflict.js', () => ({
  mergeConflictStrategy: {
    name: 'merge-conflict',
    detect: vi.fn(() => false),
    diagnose: vi.fn(() => ({})),
    heal: vi.fn(async () => ({ healed: true, action: 'rebased' })),
  },
}));
vi.mock('./strategies/rate-limit.js', () => ({
  rateLimitStrategy: {
    name: 'rate-limit',
    detect: vi.fn(() => false),
    diagnose: vi.fn(() => ({})),
    heal: vi.fn(async () => ({ healed: false, action: 'no-fallback-available' })),
  },
}));
vi.mock('./strategies/github-api-error.js', () => ({
  githubApiErrorStrategy: {
    name: 'github-api-error',
    detect: vi.fn(() => false),
    diagnose: vi.fn(() => ({})),
    heal: vi.fn(async () => ({ healed: true, attempts: 2 })),
  },
}));
vi.mock('./strategies/agent-timeout.js', () => ({
  agentTimeoutStrategy: {
    name: 'agent-timeout',
    detect: vi.fn(() => false),
    diagnose: vi.fn(() => ({})),
    heal: vi.fn(async () => ({ healed: true, fasterModel: 'claude-haiku' })),
  },
}));
vi.mock('./strategies/firebase-down.js', () => ({
  firebaseDownStrategy: {
    name: 'firebase-down',
    detect: vi.fn(() => false),
    diagnose: vi.fn(() => ({})),
    heal: vi.fn(async () => ({ healed: true, action: 'offline-mode' })),
  },
}));

const { eventBus } = await import('../events/event-bus.js');
const { saveHealingAttempt } = await import('../knowledge/knowledge-graph.js');
const { mergeConflictStrategy } = await import('./strategies/merge-conflict.js');
const { testFailureStrategy } = await import('./strategies/test-failure.js');
const { rateLimitStrategy } = await import('./strategies/rate-limit.js');

import { healingEngine, HEALING_STRATEGIES } from './healing-engine.js';

describe('healingEngine.attemptHealing', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns healed=false when no strategy matches', async () => {
    const result = await healingEngine.attemptHealing({ errorMessage: 'unknown error' });
    expect(result.healed).toBe(false);
    expect(result.strategy).toBeNull();
  });

  it('dispatches to correct strategy by type', async () => {
    const result = await healingEngine.attemptHealing({
      type: 'merge-conflict',
      errorMessage: 'CONFLICTING',
      branchName: 'feature/test',
    });
    expect(result.healed).toBe(true);
    expect(result.strategy).toBe('merge-conflict');
    expect(mergeConflictStrategy.heal).toHaveBeenCalledOnce();
  });

  it('auto-detects strategy when type not provided', async () => {
    testFailureStrategy.detect.mockReturnValue(true);
    const result = await healingEngine.attemptHealing({ errorMessage: 'Tests failed' });
    expect(result.strategy).toBe('test-failure');
  });

  it('emits SELF_HEALING_ATTEMPTED event', async () => {
    mergeConflictStrategy.detect.mockReturnValue(true);
    await healingEngine.attemptHealing({ errorMessage: 'merge conflict' });
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'self-healing:attempted',
      expect.objectContaining({ metadata: expect.objectContaining({ strategy: 'merge-conflict' }) }),
    );
  });

  it('emits SELF_HEALING_SUCCEEDED when strategy heals', async () => {
    mergeConflictStrategy.detect.mockReturnValue(true);
    await healingEngine.attemptHealing({ errorMessage: 'conflict' });
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'self-healing:succeeded',
      expect.anything(),
    );
  });

  it('emits SELF_HEALING_FAILED when strategy cannot heal', async () => {
    rateLimitStrategy.detect.mockReturnValue(true);
    const result = await healingEngine.attemptHealing({ errorMessage: 'rate limit' });
    expect(result.healed).toBe(false);
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'self-healing:failed',
      expect.anything(),
    );
  });

  it('handles exception thrown by strategy', async () => {
    testFailureStrategy.detect.mockReturnValue(true);
    testFailureStrategy.heal.mockRejectedValue(new Error('unexpected'));
    const result = await healingEngine.attemptHealing({ errorMessage: 'Tests failed' });
    expect(result.healed).toBe(false);
    expect(result.strategy).toBe('test-failure');
  });
});

describe('healingEngine.handleFailure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    healingEngine._attemptCounts.clear();
  });

  it('increments attempt count and delegates to attemptHealing', async () => {
    mergeConflictStrategy.detect.mockReturnValue(true);
    const result = await healingEngine.handleFailure({
      taskId: 'task-1',
      projectId: 'proj-A',
      errorMessage: 'merge conflict',
    });
    expect(result.healed).toBe(true);
    expect(result.strategy).toBe('merge-conflict');
    expect(result.exhausted).toBe(false);
  });

  it('emits SELF_HEAL_RECOVERED when strategy succeeds', async () => {
    mergeConflictStrategy.detect.mockReturnValue(true);
    await healingEngine.handleFailure({
      taskId: 'task-2',
      projectId: 'proj-A',
      errorMessage: 'conflict',
    });
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'self-heal:recovered',
      expect.objectContaining({ metadata: expect.objectContaining({ taskId: 'task-2', strategy: 'merge-conflict' }) }),
    );
  });

  it('clears attempt count after successful heal', async () => {
    mergeConflictStrategy.detect.mockReturnValue(true);
    const ctx = { taskId: 'task-clear', projectId: 'proj-A', errorMessage: 'conflict' };
    await healingEngine.handleFailure(ctx);
    expect(healingEngine._attemptCounts.has('task:task-clear:conflict')).toBe(false);
  });

  it('returns exhausted=true and emits SELF_HEAL_EXHAUSTED when max attempts reached', async () => {
    rateLimitStrategy.detect.mockReturnValue(true);
    const ctx = { taskId: 'task-ex', projectId: 'proj-B', errorMessage: 'rate limit hit' };
    // First 2 calls consume the budget (MAX_HEALING_ATTEMPTS = 2)
    await healingEngine.handleFailure(ctx);
    await healingEngine.handleFailure(ctx);
    // 3rd call should be blocked immediately
    const result = await healingEngine.handleFailure(ctx);
    expect(result.exhausted).toBe(true);
    expect(result.healed).toBe(false);
    expect(eventBus.emitEvent).toHaveBeenCalledWith('self-heal:exhausted', expect.anything());
  });

  it('persists attempt to KnowledgeGraph when taskId and projectId are present', async () => {
    mergeConflictStrategy.detect.mockReturnValue(true);
    await healingEngine.handleFailure({
      taskId: 'task-kg',
      projectId: 'proj-kg',
      errorMessage: 'merge conflict',
    });
    expect(saveHealingAttempt).toHaveBeenCalledWith(
      'proj-kg',
      'task-kg',
      expect.objectContaining({ strategy: 'merge-conflict', healed: true }),
    );
  });

  it('skips KnowledgeGraph persistence when taskId or projectId is missing', async () => {
    mergeConflictStrategy.detect.mockReturnValue(true);
    await healingEngine.handleFailure({ errorMessage: 'merge conflict' });
    expect(saveHealingAttempt).not.toHaveBeenCalled();
  });

  it('uses separate attempt counters for different projects when taskId is absent', async () => {
    rateLimitStrategy.detect.mockReturnValue(true);
    const ctxA = { projectId: 'proj-A', errorMessage: 'rate limit hit' };
    const ctxB = { projectId: 'proj-B', errorMessage: 'rate limit hit' };
    // Exhaust proj-A
    await healingEngine.handleFailure(ctxA);
    await healingEngine.handleFailure(ctxA);
    const exhaustedA = await healingEngine.handleFailure(ctxA);
    // proj-B should still have fresh budget
    const resultB = await healingEngine.handleFailure(ctxB);
    expect(exhaustedA.exhausted).toBe(true);
    expect(resultB.exhausted).toBe(false);
  });
});

describe('HEALING_STRATEGIES constants', () => {
  it('has all 6 strategy names', () => {
    expect(Object.keys(HEALING_STRATEGIES)).toHaveLength(6);
    expect(HEALING_STRATEGIES.TEST_FAILURE).toBe('test-failure');
    expect(HEALING_STRATEGIES.MERGE_CONFLICT).toBe('merge-conflict');
    expect(HEALING_STRATEGIES.RATE_LIMIT).toBe('rate-limit');
    expect(HEALING_STRATEGIES.GITHUB_API_ERROR).toBe('github-api-error');
    expect(HEALING_STRATEGIES.AGENT_TIMEOUT).toBe('agent-timeout');
    expect(HEALING_STRATEGIES.FIREBASE_DOWN).toBe('firebase-down');
  });
});
