import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockConfig, mockDbRef } = vi.hoisted(() => {
  const mockDbRef = {
    once: vi.fn().mockResolvedValue({ val: () => null }),
    transaction: vi.fn().mockImplementation(async (cb) => cb(null)),
  };

  return {
    mockConfig: {
      smartModelRouting: true,
      smartModelRoutingMinTasks: 3,
      smartModelRoutingThreshold: 0.6,
      defaultProjectId: 'default-project',
    },
    mockDbRef,
  };
});

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: { SMART_ROUTING_APPLIED: 'smart-routing:applied' },
}));

vi.mock('./model-selector.js', () => ({
  selectModel: vi.fn((_cli, _role, _complexity, override) => override || 'haiku'),
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getDb: vi.fn(() => ({
    ref: vi.fn(() => mockDbRef),
  })),
}));

import { selectModelSmart, recordRoutingOutcome, escalateModel } from './smart-model-router.js';
import { selectModel } from './model-selector.js';
import { eventBus } from '../events/event-bus.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.smartModelRouting = true;
  mockConfig.smartModelRoutingMinTasks = 3;
  mockConfig.defaultProjectId = 'default-project';
  mockDbRef.once.mockResolvedValue({ val: () => null });
  mockDbRef.transaction.mockImplementation(async (cb) => cb(null));
});

// --- selectModelSmart ---

describe('selectModelSmart — feature disabled', () => {
  it('falls back to selectModel when smartModelRouting is false', async () => {
    mockConfig.smartModelRouting = false;
    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: 'proj-1',
    });
    expect(selectModel).toHaveBeenCalledWith('claude', 'CODER', 'standard', undefined);
    expect(result).toBe('haiku');
  });

  it('passes taskOverride to selectModel when feature is disabled', async () => {
    mockConfig.smartModelRouting = false;
    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      taskOverride: 'opus',
    });
    expect(selectModel).toHaveBeenCalledWith('claude', 'CODER', 'standard', 'opus');
    expect(result).toBe('opus');
  });
});

describe('selectModelSmart — taskOverride highest priority', () => {
  it('returns taskOverride immediately when feature is enabled and data is sufficient', async () => {
    // Provide sufficient data so hasSufficientData=true
    const sufficientMetrics = {
      haiku: { totalTasks: 5, approvedFirstCycle: 4, avgReviewScore: 8 },
      sonnet: { totalTasks: 5, approvedFirstCycle: 3, avgReviewScore: 7 },
      opus: { totalTasks: 5, approvedFirstCycle: 2, avgReviewScore: 6 },
    };
    mockDbRef.once.mockResolvedValue({ val: () => sufficientMetrics });

    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: 'proj-1',
      taskOverride: 'sonnet',
    });

    expect(result).toBe('sonnet');
    // selectModel should NOT have been called (override bypasses everything)
    expect(selectModel).not.toHaveBeenCalled();
    // No smart routing event should be emitted
    expect(eventBus.emitEvent).not.toHaveBeenCalled();
  });
});

describe('selectModelSmart — unknown CLI', () => {
  it('falls back to selectModel when CLI has no tiers defined', async () => {
    const result = await selectModelSmart({
      cliType: 'unknown-cli',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: 'proj-1',
    });
    expect(selectModel).toHaveBeenCalled();
    expect(result).toBe('haiku');
  });
});

describe('selectModelSmart — insufficient data fallback', () => {
  it('falls back to selectModel when metricsMap is null', async () => {
    mockDbRef.once.mockResolvedValue({ val: () => null });

    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: 'proj-1',
    });

    expect(selectModel).toHaveBeenCalledWith('claude', 'CODER', 'standard', undefined);
    expect(result).toBe('haiku');
  });

  it('falls back when a model has fewer tasks than MIN_TASKS', async () => {
    const insufficientMetrics = {
      haiku: { totalTasks: 1, approvedFirstCycle: 1, avgReviewScore: 9 },
      sonnet: { totalTasks: 5, approvedFirstCycle: 3, avgReviewScore: 7 },
      opus: { totalTasks: 5, approvedFirstCycle: 2, avgReviewScore: 6 },
    };
    mockDbRef.once.mockResolvedValue({ val: () => insufficientMetrics });

    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: 'proj-1',
    });

    expect(selectModel).toHaveBeenCalled();
  });

  it('falls back when no projectId is available', async () => {
    mockConfig.defaultProjectId = '';
    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: '',
    });
    expect(selectModel).toHaveBeenCalled();
  });
});

describe('selectModelSmart — epsilon-greedy scoring', () => {
  const sufficientMetrics = {
    haiku: { totalTasks: 10, approvedFirstCycle: 9, avgReviewScore: 9 }, // best score
    sonnet: { totalTasks: 10, approvedFirstCycle: 5, avgReviewScore: 6 },
    opus: { totalTasks: 10, approvedFirstCycle: 3, avgReviewScore: 5 },
  };

  it('exploits: picks highest scoring model when Math.random returns > 0.1', async () => {
    mockDbRef.once.mockResolvedValue({ val: () => sufficientMetrics });
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // exploitation

    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: 'proj-1',
    });

    // haiku has best score: efficiency=0.9, quality=0.9, total=0.9
    expect(result).toBe('haiku');
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'smart-routing:applied',
      expect.objectContaining({
        metadata: expect.objectContaining({ selectionMethod: 'exploit' }),
      }),
    );
  });

  it('explores: picks a random model when Math.random returns < 0.1', async () => {
    mockDbRef.once.mockResolvedValue({ val: () => sufficientMetrics });
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.05) // trigger exploration
      .mockReturnValueOnce(0.0); // pick index 0 → haiku

    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: 'proj-1',
    });

    expect(['haiku', 'sonnet', 'opus']).toContain(result);
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'smart-routing:applied',
      expect.objectContaining({
        metadata: expect.objectContaining({ selectionMethod: 'explore' }),
      }),
    );
  });

  it('handles missing avgReviewScore gracefully (defaults quality to 0)', async () => {
    const metricsNoScore = {
      haiku: { totalTasks: 5, approvedFirstCycle: 5, avgReviewScore: null },
      sonnet: { totalTasks: 5, approvedFirstCycle: 5, avgReviewScore: null },
      opus: { totalTasks: 5, approvedFirstCycle: 5, avgReviewScore: null },
    };
    mockDbRef.once.mockResolvedValue({ val: () => metricsNoScore });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const result = await selectModelSmart({
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
      projectId: 'proj-1',
    });

    expect(['haiku', 'sonnet', 'opus']).toContain(result);
  });
});

// --- escalateModel ---

describe('escalateModel', () => {
  it('returns next tier model for claude', () => {
    expect(escalateModel('claude', 'haiku')).toBe('sonnet');
    expect(escalateModel('claude', 'sonnet')).toBe('opus');
  });

  it('returns null when already at highest tier', () => {
    expect(escalateModel('claude', 'opus')).toBeNull();
  });

  it('returns null when model is not in tiers', () => {
    expect(escalateModel('claude', 'unknown-model')).toBeNull();
  });

  it('returns null for unknown CLI', () => {
    expect(escalateModel('unknown-cli', 'haiku')).toBeNull();
  });

  it('works for codex tiers', () => {
    expect(escalateModel('codex', 'codex-mini')).toBe('o4-mini');
    expect(escalateModel('codex', 'o4-mini')).toBe('o3');
    expect(escalateModel('codex', 'o3')).toBeNull();
  });
});

// --- recordRoutingOutcome ---

describe('recordRoutingOutcome', () => {
  it('does nothing when smartModelRouting is disabled', async () => {
    mockConfig.smartModelRouting = false;
    await recordRoutingOutcome({
      projectId: 'proj-1',
      role: 'coder',
      model: 'haiku',
      approved: true,
      approvedFirstCycle: true,
    });
    expect(mockDbRef.transaction).not.toHaveBeenCalled();
  });

  it('does nothing when projectId is missing', async () => {
    await recordRoutingOutcome({
      projectId: '',
      role: 'coder',
      model: 'haiku',
      approved: true,
      approvedFirstCycle: true,
    });
    expect(mockDbRef.transaction).not.toHaveBeenCalled();
  });

  it('does nothing when model is missing', async () => {
    await recordRoutingOutcome({
      projectId: 'proj-1',
      role: 'coder',
      model: '',
      approved: true,
      approvedFirstCycle: true,
    });
    expect(mockDbRef.transaction).not.toHaveBeenCalled();
  });

  it('initialises aggregate on first record (current=null)', async () => {
    let capturedResult;
    mockDbRef.transaction.mockImplementation(async (cb) => {
      capturedResult = cb(null);
    });

    await recordRoutingOutcome({
      projectId: 'proj-1',
      role: 'coder',
      model: 'haiku',
      approved: true,
      approvedFirstCycle: true,
      reviewScore: 8,
      tokenCount: 100,
      complexityLevel: 'standard',
      taskType: 'feature',
    });

    expect(capturedResult).toMatchObject({
      model: 'haiku',
      role: 'coder',
      totalTasks: 1,
      approvedFirstCycle: 1,
      avgTokens: 100,
      avgReviewScore: 8,
      scoredTaskCount: 1,
    });
    expect(capturedResult.byComplexity.standard).toEqual({ count: 1, approved: 1 });
    expect(capturedResult.byTaskType.feature).toEqual({ count: 1 });
  });

  it('updates aggregate correctly on subsequent records', async () => {
    let capturedResult;
    mockDbRef.transaction.mockImplementation(async (cb) => {
      capturedResult = cb({
        model: 'haiku',
        role: 'coder',
        totalTasks: 2,
        approvedFirstCycle: 2,
        avgTokens: 100,
        avgReviewScore: 8,
        scoredTaskCount: 2,
        byComplexity: {
          trivial: { count: 0, approved: 0 },
          standard: { count: 2, approved: 2 },
          complex: { count: 0, approved: 0 },
        },
        byTaskType: { feature: { count: 2 } },
      });
    });

    await recordRoutingOutcome({
      projectId: 'proj-1',
      role: 'coder',
      model: 'haiku',
      approved: false,
      approvedFirstCycle: false,
      reviewScore: 6,
      tokenCount: 200,
      complexityLevel: 'standard',
      taskType: 'bug',
    });

    expect(capturedResult.totalTasks).toBe(3);
    expect(capturedResult.approvedFirstCycle).toBe(2); // not incremented
    expect(capturedResult.byComplexity.standard.count).toBe(3);
    expect(capturedResult.byComplexity.standard.approved).toBe(2); // not approved
    expect(capturedResult.byTaskType.bug).toEqual({ count: 1 });
    // avgReviewScore: incremental average of [8, 8, 6] at scoredTaskCount=3 → 8 + (6-8)/3 ≈ 7.33
    expect(capturedResult.avgReviewScore).toBeCloseTo(7.33, 1);
  });

  it('handles Firebase errors gracefully (does not throw)', async () => {
    mockDbRef.transaction.mockRejectedValue(new Error('Firebase down'));

    await expect(recordRoutingOutcome({
      projectId: 'proj-1',
      role: 'coder',
      model: 'haiku',
      approved: true,
      approvedFirstCycle: true,
    })).resolves.toBeUndefined();
  });

  it('stores reviewScore as null when not provided', async () => {
    let capturedResult;
    mockDbRef.transaction.mockImplementation(async (cb) => {
      capturedResult = cb(null);
    });

    await recordRoutingOutcome({
      projectId: 'proj-1',
      role: 'coder',
      model: 'haiku',
      approved: true,
      approvedFirstCycle: true,
    });

    expect(capturedResult.avgReviewScore).toBeNull();
    expect(capturedResult.scoredTaskCount).toBe(0);
  });
});
