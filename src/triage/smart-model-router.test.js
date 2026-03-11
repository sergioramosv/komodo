import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTransaction, mockOnce, mockRef, mockGetDb } = vi.hoisted(() => {
  const mockTransaction = vi.fn();
  const mockOnce = vi.fn();
  const mockRef = vi.fn(() => ({ transaction: mockTransaction, once: mockOnce }));
  const mockGetDb = vi.fn(() => ({ ref: mockRef }));
  return { mockTransaction, mockOnce, mockRef, mockGetDb };
});

vi.mock('../config.js', () => ({
  config: {
    smartModelRouting: true,
    smartModelRoutingMinTasks: 5,
    smartModelRoutingEscalationThreshold: 5,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: vi.fn().mockReturnValue({}),
  },
  EVENT_TYPES: {
    MODEL_ROUTING_SELECTED: 'triage:model-routing:selected',
    MODEL_ROUTING_RECORDED: 'metrics:model-routing:recorded',
    MODEL_ESCALATED: 'triage:model-escalated',
  },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getDb: mockGetDb,
}));

import { getEscalationModel, selectModelSmart, recordRoutingMetrics } from './smart-model-router.js';
import { config } from '../config.js';
import { eventBus } from '../events/event-bus.js';

// ─── getEscalationModel ──────────────────────────────────────────────────────

describe('getEscalationModel', () => {
  it('escalates haiku → sonnet for claude', () => {
    expect(getEscalationModel('claude', 'haiku')).toBe('sonnet');
  });

  it('escalates sonnet → opus for claude', () => {
    expect(getEscalationModel('claude', 'sonnet')).toBe('opus');
  });

  it('stays at opus (already top of chain) for claude', () => {
    expect(getEscalationModel('claude', 'opus')).toBe('opus');
  });

  it('escalates codex-mini → o4-mini for codex', () => {
    expect(getEscalationModel('codex', 'codex-mini')).toBe('o4-mini');
  });

  it('escalates o4-mini → o3 for codex', () => {
    expect(getEscalationModel('codex', 'o4-mini')).toBe('o3');
  });

  it('stays at o3 (top of chain) for codex', () => {
    expect(getEscalationModel('codex', 'o3')).toBe('o3');
  });

  it('escalates gemini-2.5-flash → gemini-2.5-pro', () => {
    expect(getEscalationModel('gemini', 'gemini-2.5-flash')).toBe('gemini-2.5-pro');
  });

  it('stays at gemini-2.5-pro (top of chain)', () => {
    expect(getEscalationModel('gemini', 'gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });

  it('returns currentModel for unknown CLI', () => {
    expect(getEscalationModel('unknown-cli', 'some-model')).toBe('some-model');
  });

  it('returns currentModel for model not in chain', () => {
    expect(getEscalationModel('claude', 'unknown-model')).toBe('unknown-model');
  });

  it('is case-insensitive for CLI name', () => {
    expect(getEscalationModel('CLAUDE', 'haiku')).toBe('sonnet');
  });
});

// ─── selectModelSmart ────────────────────────────────────────────────────────

describe('selectModelSmart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.smartModelRouting = true;
    config.smartModelRoutingMinTasks = 5;
  });

  it('returns disabled when smartModelRouting is false', async () => {
    config.smartModelRouting = false;
    const result = await selectModelSmart({
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
    });
    expect(result.model).toBeNull();
    expect(result.source).toBe('disabled');
  });

  it('returns insufficient-data when no models have enough tasks', async () => {
    mockOnce.mockResolvedValueOnce({
      val: () => ({
        sonnet: {
          model: 'sonnet',
          totalTasks: 3,
          approvedFirstCycle: 2,
          avgReviewScore: 8,
        },
      }),
    });

    const result = await selectModelSmart({
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
    });

    expect(result.model).toBeNull();
    expect(result.source).toBe('insufficient-data');
  });

  it('returns insufficient-data when Firebase returns no data', async () => {
    mockOnce.mockResolvedValueOnce({ val: () => null });

    const result = await selectModelSmart({
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
    });

    expect(result.model).toBeNull();
    expect(result.source).toBe('insufficient-data');
  });

  it('selects model with highest score when exploiting', async () => {
    mockOnce.mockResolvedValueOnce({
      val: () => ({
        sonnet: {
          model: 'sonnet',
          totalTasks: 10,
          approvedFirstCycle: 5,
          avgReviewScore: 7,
          scoredTaskCount: 10,
        },
        opus: {
          model: 'opus',
          totalTasks: 10,
          approvedFirstCycle: 9,
          avgReviewScore: 9,
          scoredTaskCount: 10,
        },
      }),
    });

    // Force exploitation: random > epsilon (0.1)
    const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const result = await selectModelSmart({
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
    });

    expect(result.model).toBe('opus'); // opus has higher score
    expect(result.source).toBe('exploit');
    mockRandom.mockRestore();
  });

  it('selects random model during exploration (epsilon < 0.1)', async () => {
    mockOnce.mockResolvedValueOnce({
      val: () => ({
        sonnet: { model: 'sonnet', totalTasks: 10, approvedFirstCycle: 8, avgReviewScore: 8, scoredTaskCount: 10 },
        opus: { model: 'opus', totalTasks: 10, approvedFirstCycle: 5, avgReviewScore: 6, scoredTaskCount: 10 },
      }),
    });

    // Force exploration: first random < 0.1, second picks index 0
    const mockRandom = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.05)
      .mockReturnValueOnce(0);

    const result = await selectModelSmart({
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
    });

    expect(result.source).toBe('explore');
    expect(result.model).toBeTruthy();
    mockRandom.mockRestore();
  });

  it('emits MODEL_ROUTING_SELECTED event on successful selection', async () => {
    mockOnce.mockResolvedValueOnce({
      val: () => ({
        opus: { model: 'opus', totalTasks: 10, approvedFirstCycle: 9, avgReviewScore: 9, scoredTaskCount: 10 },
      }),
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    await selectModelSmart({
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'complex',
      taskType: 'feature',
    });

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'triage:model-routing:selected',
      expect.objectContaining({
        metadata: expect.objectContaining({
          model: 'opus',
          cliType: 'claude',
          agentRole: 'CODER',
          complexityLevel: 'complex',
          taskType: 'feature',
        }),
      }),
    );
    vi.restoreAllMocks();
  });

  it('returns null gracefully when Firebase throws (treated as no data)', async () => {
    mockOnce.mockRejectedValueOnce(new Error('Firebase connection failed'));

    const result = await selectModelSmart({
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'standard',
    });

    expect(result.model).toBeNull();
    // Firebase errors in fetchModelStats are swallowed → returns [] → insufficient-data
    expect(['insufficient-data', 'error']).toContain(result.source);
  });

  it('uses complexity-specific stats when available and enough tasks', async () => {
    mockOnce.mockResolvedValueOnce({
      val: () => ({
        sonnet: {
          model: 'sonnet',
          totalTasks: 10,
          approvedFirstCycle: 5,
          avgReviewScore: 7,
          byComplexity: {
            trivial: { count: 8, approvedFirstCycle: 7, avgReviewScore: 9 },
          },
        },
        haiku: {
          model: 'haiku',
          totalTasks: 10,
          approvedFirstCycle: 3,
          avgReviewScore: 6,
          byComplexity: {
            trivial: { count: 8, approvedFirstCycle: 3, avgReviewScore: 6 },
          },
        },
      }),
    });

    vi.spyOn(Math, 'random').mockReturnValue(0.5); // exploit

    const result = await selectModelSmart({
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      complexityLevel: 'trivial',
    });

    // sonnet has higher trivial score (7 approved out of 8 + avg 9)
    expect(result.model).toBe('sonnet');
    expect(result.source).toBe('exploit');
    vi.restoreAllMocks();
  });
});

// ─── recordRoutingMetrics ────────────────────────────────────────────────────

describe('recordRoutingMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.smartModelRouting = true;
  });

  it('returns { recorded: false } when smartModelRouting is disabled', async () => {
    config.smartModelRouting = false;
    const result = await recordRoutingMetrics({
      taskId: 'task1',
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      model: 'sonnet',
      complexityLevel: 'standard',
      approvedFirstCycle: true,
      reviewScore: 9,
    });
    expect(result.recorded).toBe(false);
  });

  it('returns { recorded: false } when missing required fields', async () => {
    const result = await recordRoutingMetrics({
      taskId: '',
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      model: '',
      complexityLevel: 'standard',
      approvedFirstCycle: true,
      reviewScore: 9,
    });
    expect(result.recorded).toBe(false);
  });

  it('creates first-time record correctly (transaction callback with null)', async () => {
    let capturedCallback;
    mockTransaction.mockImplementation((cb) => {
      capturedCallback = cb;
      return Promise.resolve(cb(null));
    });

    await recordRoutingMetrics({
      taskId: 'task1',
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      model: 'sonnet',
      complexityLevel: 'standard',
      taskType: 'feature',
      approvedFirstCycle: true,
      reviewScore: 8,
      tokens: 500,
    });

    const newRecord = capturedCallback(null);
    expect(newRecord.totalTasks).toBe(1);
    expect(newRecord.approvedFirstCycle).toBe(1);
    expect(newRecord.avgReviewScore).toBe(8);
    expect(newRecord.byComplexity.standard.count).toBe(1);
    expect(newRecord.byTaskType.feature.count).toBe(1);
  });

  it('updates existing record with incremental averages', async () => {
    const existing = {
      model: 'sonnet',
      totalTasks: 4,
      approvedFirstCycle: 3,
      avgTokens: 400,
      avgReviewScore: 7,
      scoredTaskCount: 4,
      byComplexity: {
        standard: { count: 4, approvedFirstCycle: 3, avgReviewScore: 7 },
      },
      byTaskType: {},
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };

    let capturedCallback;
    mockTransaction.mockImplementation((cb) => {
      capturedCallback = cb;
      return Promise.resolve(cb(existing));
    });

    await recordRoutingMetrics({
      taskId: 'task5',
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      model: 'sonnet',
      complexityLevel: 'standard',
      approvedFirstCycle: true,
      reviewScore: 9,
    });

    const updated = capturedCallback(existing);
    expect(updated.totalTasks).toBe(5);
    expect(updated.approvedFirstCycle).toBe(4);
    expect(updated.avgReviewScore).toBeCloseTo(7.4, 1); // (7*4 + 9) / 5
    expect(updated.byComplexity.standard.count).toBe(5);
  });

  it('emits MODEL_ROUTING_RECORDED event on success', async () => {
    mockTransaction.mockResolvedValueOnce(undefined);

    await recordRoutingMetrics({
      taskId: 'task1',
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      model: 'opus',
      complexityLevel: 'complex',
      approvedFirstCycle: false,
      reviewScore: 6,
    });

    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'metrics:model-routing:recorded',
      expect.objectContaining({
        metadata: expect.objectContaining({
          model: 'opus',
          cliType: 'claude',
          agentRole: 'CODER',
        }),
      }),
    );
  });

  it('handles Firebase error gracefully', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('Firebase down'));

    const result = await recordRoutingMetrics({
      taskId: 'task1',
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      model: 'sonnet',
      complexityLevel: 'standard',
      approvedFirstCycle: true,
      reviewScore: 8,
    });

    expect(result.recorded).toBe(false);
  });

  it('handles null reviewScore without crashing', async () => {
    mockTransaction.mockImplementation((cb) => {
      cb(null);
      return Promise.resolve();
    });

    const result = await recordRoutingMetrics({
      taskId: 'task1',
      projectId: 'proj1',
      cliType: 'claude',
      agentRole: 'CODER',
      model: 'sonnet',
      complexityLevel: 'standard',
      approvedFirstCycle: false,
      reviewScore: null,
    });

    expect(result.recorded).toBe(true);
  });

  it('writes to correct Firebase path', async () => {
    mockTransaction.mockResolvedValueOnce(undefined);

    await recordRoutingMetrics({
      taskId: 'task1',
      projectId: 'proj42',
      cliType: 'claude',
      agentRole: 'CODER',
      model: 'sonnet',
      complexityLevel: 'trivial',
      approvedFirstCycle: true,
      reviewScore: 9,
    });

    expect(mockRef).toHaveBeenCalledWith(
      'metrics/proj42/model-routing/claude/CODER/sonnet',
    );
  });

  it('converts model name with dots/hyphens to Firebase-safe key', async () => {
    mockTransaction.mockResolvedValueOnce(undefined);

    await recordRoutingMetrics({
      taskId: 'task1',
      projectId: 'proj1',
      cliType: 'gemini',
      agentRole: 'CODER',
      model: 'gemini-2.5-pro',
      complexityLevel: 'complex',
      approvedFirstCycle: true,
      reviewScore: 9,
    });

    expect(mockRef).toHaveBeenCalledWith(
      'metrics/proj1/model-routing/gemini/CODER/gemini_2_5_pro',
    );
  });
});
