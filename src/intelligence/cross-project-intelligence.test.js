import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const {
  mockConfig,
  mockEmitEvent,
  mockGetDb,
  mockLoadLearningStore,
  mockSaveLearningStore,
} = vi.hoisted(() => {
  const mockDbRef = vi.fn();
  const mockOnce = vi.fn();
  const mockTransaction = vi.fn();
  const mockSet = vi.fn();

  mockDbRef.mockReturnValue({
    once: mockOnce,
    transaction: mockTransaction,
    set: mockSet,
  });

  return {
    mockConfig: {
      crossProjectIntelligence: true,
      crossProjectUniversalityThreshold: 0.6,
    },
    mockEmitEvent: vi.fn(),
    mockGetDb: vi.fn(() => ({ ref: mockDbRef })),
    mockLoadLearningStore: vi.fn(),
    mockSaveLearningStore: vi.fn(),
    mockDbRef,
    mockOnce,
    mockTransaction,
    mockSet,
  };
});

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: mockEmitEvent },
  EVENT_TYPES: {
    CROSS_PROJECT_PATTERN_PROMOTED: 'cross-project:pattern:promoted',
    CROSS_PROJECT_ANTI_PATTERN_PROPAGATED: 'cross-project:anti-pattern:propagated',
    GLOBAL_MODEL_PERF_UPDATED: 'cross-project:model-perf:updated',
  },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getDb: mockGetDb,
}));

vi.mock('../knowledge/codebase-learning.js', () => ({
  loadLearningStore: mockLoadLearningStore,
  saveLearningStore: mockSaveLearningStore,
}));

import { evaluatePatternUniversality, syncPatternsToGlobal, syncModelPerformanceToGlobal, getGlobalPatterns, getGlobalAntiPatterns, applyGlobalAntiPatternsToProject, getGlobalInsights, getGlobalModelRecommendation } from './cross-project-intelligence.js';

beforeEach(() => {
  vi.resetAllMocks();
  mockConfig.crossProjectIntelligence = true;
  mockConfig.crossProjectUniversalityThreshold = 0.6;
  mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue({ once: vi.fn(), transaction: vi.fn(), set: vi.fn() }) });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluatePatternUniversality
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluatePatternUniversality', () => {
  it('returns 0 when projectsSeenIn is empty', () => {
    expect(evaluatePatternUniversality([], 10)).toBe(0);
  });

  it('returns 0 when totalProjects is 0', () => {
    expect(evaluatePatternUniversality(['p1', 'p2'], 0)).toBe(0);
  });

  it('returns 0 when totalProjects is negative', () => {
    expect(evaluatePatternUniversality(['p1'], -5)).toBe(0);
  });

  it('returns 0 when totalProjects is not finite', () => {
    expect(evaluatePatternUniversality(['p1'], NaN)).toBe(0);
    expect(evaluatePatternUniversality(['p1'], Infinity)).toBe(0);
  });

  it('returns 0 when projectsSeenIn is not an array', () => {
    expect(evaluatePatternUniversality(null, 10)).toBe(0);
    expect(evaluatePatternUniversality(undefined, 10)).toBe(0);
  });

  it('calculates correct score for partial coverage', () => {
    // 3 out of 5 projects → 0.6
    expect(evaluatePatternUniversality(['p1', 'p2', 'p3'], 5)).toBeCloseTo(0.6);
  });

  it('calculates score of 1.0 when seen in all projects', () => {
    expect(evaluatePatternUniversality(['p1', 'p2', 'p3'], 3)).toBe(1);
  });

  it('caps score at 1.0 even if projectsSeenIn exceeds totalProjects', () => {
    expect(evaluatePatternUniversality(['p1', 'p2', 'p3', 'p4'], 3)).toBe(1);
  });

  it('returns score below threshold when not universal enough', () => {
    // 1 out of 10 → 0.1, below default 0.6 threshold
    expect(evaluatePatternUniversality(['p1'], 10)).toBeCloseTo(0.1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncPatternsToGlobal — config guard
// ─────────────────────────────────────────────────────────────────────────────

describe('syncPatternsToGlobal', () => {
  it('returns early when crossProjectIntelligence is disabled', async () => {
    mockConfig.crossProjectIntelligence = false;
    const result = await syncPatternsToGlobal('proj-1');
    expect(result).toEqual({ patternsPromoted: 0, antiPatternsPropagated: 0 });
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it('returns early when projectId is falsy', async () => {
    const result = await syncPatternsToGlobal('');
    expect(result).toEqual({ patternsPromoted: 0, antiPatternsPropagated: 0 });
  });

  it('returns zeroes on Firebase error (non-blocking)', async () => {
    mockGetDb.mockImplementation(() => { throw new Error('firebase down'); });
    const result = await syncPatternsToGlobal('proj-1');
    expect(result).toEqual({ patternsPromoted: 0, antiPatternsPropagated: 0 });
  });

  it('propagates critical security anti-patterns and emits event', async () => {
    const mockRef = {
      once: vi.fn().mockResolvedValue({ val: () => ({}) }),
      transaction: vi.fn().mockImplementation(async (updater) => {
        updater(null);
        return {};
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    mockLoadLearningStore.mockReturnValue({
      patterns: [],
      antiPatterns: ['SQL injection vulnerability in user input'],
    });

    await syncPatternsToGlobal('proj-1');

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'cross-project:anti-pattern:propagated',
      expect.objectContaining({ metadata: expect.objectContaining({ isCritical: true }) }),
    );
  });

  it('promotes pattern and increments patternsPromoted when threshold is reached', async () => {
    // Pattern seen in 3 out of 4 projects → universalityScore = 0.75 >= 0.6 threshold
    const promotedPattern = {
      text: 'use async/await',
      projectsSeenIn: { 'proj-a': true, 'proj-b': true, 'proj-1': true },
      universalityScore: 0.75,
      embedding: null,
      promotedAt: new Date().toISOString(),
    };
    const projectIds = { 'proj-a': true, 'proj-b': true, 'proj-1': true, 'proj-c': true };

    const mockRef = {
      once: vi.fn()
        // First call: meta/projectIds
        .mockResolvedValueOnce({ val: () => projectIds })
        // Second call: pre-transaction read (no promotedAt yet)
        .mockResolvedValueOnce({ val: () => null })
        // Third call: read pattern after transaction
        .mockResolvedValueOnce({ val: () => promotedPattern }),
      transaction: vi.fn().mockImplementation(async (updater) => {
        updater(null);
        return {};
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    mockLoadLearningStore.mockReturnValue({
      patterns: ['use async/await'],
      antiPatterns: [],
    });

    const result = await syncPatternsToGlobal('proj-1');

    expect(result.patternsPromoted).toBe(1);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'cross-project:pattern:promoted',
      expect.objectContaining({ metadata: expect.objectContaining({ pattern: 'use async/await' }) }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncModelPerformanceToGlobal — config guard
// ─────────────────────────────────────────────────────────────────────────────

describe('syncModelPerformanceToGlobal', () => {
  it('returns early when crossProjectIntelligence is disabled', async () => {
    mockConfig.crossProjectIntelligence = false;
    const result = await syncModelPerformanceToGlobal('proj-1');
    expect(result).toEqual({ updated: 0 });
  });

  it('returns early when projectId is falsy', async () => {
    const result = await syncModelPerformanceToGlobal('');
    expect(result).toEqual({ updated: 0 });
  });

  it('returns 0 when no model data exists in Firebase', async () => {
    const mockRef = {
      once: vi.fn().mockResolvedValue({ val: () => null }),
      transaction: vi.fn(),
    };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    const result = await syncModelPerformanceToGlobal('proj-1');
    expect(result).toEqual({ updated: 0 });
  });

  it('returns zeroes on Firebase error (non-blocking)', async () => {
    mockGetDb.mockImplementation(() => { throw new Error('firebase down'); });
    const result = await syncModelPerformanceToGlobal('proj-1');
    expect(result).toEqual({ updated: 0 });
  });

  it('merges with weighted average and emits GLOBAL_MODEL_PERF_UPDATED', async () => {
    const byModel = {
      'claude-opus-4': {
        coder: { model: 'claude-opus-4', taskCount: 4, avgScore: 8, bestFor: ['refactor'], worstFor: ['greenfield'] },
      },
    };
    // existing global entry: 6 tasks, avgSuccessRate 0.5
    const existing = {
      model: 'claude-opus-4',
      role: 'coder',
      taskCount: 6,
      avgSuccessRate: 0.5,
      bestFor: ['bugfix'],
      worstFor: ['docs'],
      lastUpdatedAt: '2026-01-01T00:00:00Z',
    };

    const mockRef = {
      once: vi.fn().mockResolvedValue({ val: () => byModel }),
      transaction: vi.fn().mockImplementation(async (updater) => {
        updater(existing);
        return {};
      }),
    };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });

    const result = await syncModelPerformanceToGlobal('proj-1');

    expect(result.updated).toBe(1);

    // Verify transaction updater produced the correct weighted average
    const updaterArg = mockRef.transaction.mock.calls[0][0];
    const merged = updaterArg(existing);
    // existingCount=6 rate=0.5, incoming count=4 rate=0.8 → (6*0.5 + 4*0.8)/10 = (3+3.2)/10 = 0.62
    expect(merged.taskCount).toBe(10);
    expect(merged.avgSuccessRate).toBeCloseTo(0.62, 5);
    expect(merged.bestFor).toEqual(expect.arrayContaining(['bugfix', 'refactor']));
    expect(merged.worstFor).toEqual(expect.arrayContaining(['docs', 'greenfield']));

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'cross-project:model-perf:updated',
      expect.objectContaining({ metadata: expect.objectContaining({ modelKey: 'claude-opus-4', role: 'coder' }) }),
    );
  });

  it('creates new entry with correct fields when no existing data', async () => {
    const byModel = {
      'claude-haiku': {
        planner: { model: 'claude-haiku', taskCount: 3, avgScore: 7, bestFor: ['simple'], worstFor: [] },
      },
    };

    const mockRef = {
      once: vi.fn().mockResolvedValue({ val: () => byModel }),
      transaction: vi.fn().mockImplementation(async (updater) => {
        updater(null); // no existing entry
        return {};
      }),
    };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });

    const result = await syncModelPerformanceToGlobal('proj-1');
    expect(result.updated).toBe(1);

    const updaterArg = mockRef.transaction.mock.calls[0][0];
    const created = updaterArg(null);
    expect(created.model).toBe('claude-haiku');
    expect(created.role).toBe('planner');
    expect(created.taskCount).toBe(3);
    expect(created.avgSuccessRate).toBeCloseTo(0.7, 5);
    expect(created.bestFor).toEqual(['simple']);
    expect(created.worstFor).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getGlobalPatterns
// ─────────────────────────────────────────────────────────────────────────────

describe('getGlobalPatterns', () => {
  it('returns empty array when Firebase has no data', async () => {
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => null }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    const result = await getGlobalPatterns();
    expect(result).toEqual([]);
  });

  it('filters by minScore', async () => {
    const data = {
      p1: { text: 'use async/await', universalityScore: 0.8, projectsSeenIn: { a: true, b: true } },
      p2: { text: 'use callbacks', universalityScore: 0.3, projectsSeenIn: { c: true } },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => data }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });

    const result = await getGlobalPatterns({ minScore: 0.6 });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('use async/await');
  });

  it('sorts by universalityScore descending', async () => {
    const data = {
      p1: { text: 'A', universalityScore: 0.5, projectsSeenIn: {} },
      p2: { text: 'B', universalityScore: 0.9, projectsSeenIn: {} },
      p3: { text: 'C', universalityScore: 0.7, projectsSeenIn: {} },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => data }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });

    const result = await getGlobalPatterns({ minScore: 0 });
    expect(result.map(r => r.text)).toEqual(['B', 'C', 'A']);
  });

  it('returns empty array on Firebase error', async () => {
    mockGetDb.mockImplementation(() => { throw new Error('firebase down'); });
    const result = await getGlobalPatterns();
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getGlobalAntiPatterns
// ─────────────────────────────────────────────────────────────────────────────

describe('getGlobalAntiPatterns', () => {
  it('returns all anti-patterns when criticalOnly is false', async () => {
    const data = {
      ap1: { text: 'avoid magic numbers', isCritical: false, projectsSeenIn: {} },
      ap2: { text: 'SQL injection', isCritical: true, projectsSeenIn: {} },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => data }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });

    const result = await getGlobalAntiPatterns();
    expect(result).toHaveLength(2);
  });

  it('filters to only critical anti-patterns when criticalOnly is true', async () => {
    const data = {
      ap1: { text: 'avoid magic numbers', isCritical: false, projectsSeenIn: {} },
      ap2: { text: 'XSS vulnerability', isCritical: true, projectsSeenIn: {} },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => data }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });

    const result = await getGlobalAntiPatterns({ criticalOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('XSS vulnerability');
  });

  it('returns empty array on Firebase error', async () => {
    mockGetDb.mockImplementation(() => { throw new Error('firebase down'); });
    const result = await getGlobalAntiPatterns();
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyGlobalAntiPatternsToProject
// ─────────────────────────────────────────────────────────────────────────────

describe('applyGlobalAntiPatternsToProject', () => {
  it('returns early when crossProjectIntelligence is disabled', async () => {
    mockConfig.crossProjectIntelligence = false;
    const result = await applyGlobalAntiPatternsToProject('proj-1');
    expect(result).toEqual({ applied: 0 });
  });

  it('returns early when projectId is falsy', async () => {
    const result = await applyGlobalAntiPatternsToProject('');
    expect(result).toEqual({ applied: 0 });
  });

  it('applies critical anti-patterns not already in local store', async () => {
    const criticalData = {
      ap1: { text: 'XSS vulnerability', isCritical: true, projectsSeenIn: {} },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => criticalData }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    mockLoadLearningStore.mockReturnValue({ patterns: [], antiPatterns: [] });

    const result = await applyGlobalAntiPatternsToProject('proj-1');

    expect(result.applied).toBe(1);
    expect(mockSaveLearningStore).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        antiPatterns: expect.arrayContaining(['[global] XSS vulnerability']),
      }),
    );
  });

  it('skips anti-patterns already present in local store', async () => {
    const criticalData = {
      ap1: { text: 'XSS vulnerability', isCritical: true, projectsSeenIn: {} },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => criticalData }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    mockLoadLearningStore.mockReturnValue({
      patterns: [],
      antiPatterns: ['xss vulnerability'], // already present (case insensitive)
    });

    const result = await applyGlobalAntiPatternsToProject('proj-1');
    expect(result.applied).toBe(0);
    expect(mockSaveLearningStore).not.toHaveBeenCalled();
  });

  it('returns zeroes on error (non-blocking)', async () => {
    mockGetDb.mockImplementation(() => { throw new Error('firebase down'); });
    const result = await applyGlobalAntiPatternsToProject('proj-1');
    expect(result).toEqual({ applied: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getGlobalInsights
// ─────────────────────────────────────────────────────────────────────────────

describe('getGlobalInsights', () => {
  function makeRef(patternsData, antiPatternsData) {
    return vi.fn().mockImplementation((path) => {
      if (path.includes('anti-patterns')) {
        return { once: vi.fn().mockResolvedValue({ val: () => antiPatternsData }) };
      }
      return { once: vi.fn().mockResolvedValue({ val: () => patternsData }) };
    });
  }

  it('returns empty string when no patterns and no anti-patterns', async () => {
    mockGetDb.mockReturnValue({ ref: makeRef(null, null) });
    const result = await getGlobalInsights({ title: 'add login feature' });
    expect(result).toBe('');
  });

  it('includes relevant patterns (keyword overlap with task title)', async () => {
    const patterns = {
      p1: { text: 'use async/await for async operations', universalityScore: 0.8, projectsSeenIn: {} },
      p2: { text: 'use short variable names', universalityScore: 0.9, projectsSeenIn: {} },
    };
    mockGetDb.mockReturnValue({ ref: makeRef(patterns, null) });

    const result = await getGlobalInsights({ title: 'async task processing' });
    expect(result).toContain('async');
    expect(result).not.toContain('short variable');
  });

  it('always includes anti-patterns regardless of relevance', async () => {
    const antiPatterns = {
      ap1: { text: 'SQL injection in raw queries', isCritical: true, projectsSeenIn: {} },
    };
    mockGetDb.mockReturnValue({ ref: makeRef(null, antiPatterns) });

    const result = await getGlobalInsights({ title: 'add login feature' });
    expect(result).toContain('SQL injection');
  });

  it('includes patterns matching acceptanceCriteria keywords', async () => {
    const patterns = {
      p1: { text: 'always validate input at boundaries', universalityScore: 0.7, projectsSeenIn: {} },
    };
    mockGetDb.mockReturnValue({ ref: makeRef(patterns, null) });

    const result = await getGlobalInsights({
      title: 'user registration',
      acceptanceCriteria: ['validate email format', 'validate password length'],
    });
    expect(result).toContain('validate');
  });

  it('caps output at 2000 characters', async () => {
    const longText = 'x'.repeat(400);
    const patterns = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `p${i}`,
        { text: `pattern ${longText} ${i}`, universalityScore: 0.9, projectsSeenIn: {} },
      ]),
    );
    const antiPatterns = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        `ap${i}`,
        { text: `anti-pattern ${longText} ${i}`, isCritical: false, projectsSeenIn: {} },
      ]),
    );
    mockGetDb.mockReturnValue({ ref: makeRef(patterns, antiPatterns) });

    const result = await getGlobalInsights({ title: `pattern anti-pattern ${longText}` });
    expect(result.length).toBeLessThanOrEqual(2000);
  });

  it('returns empty string on Firebase error (non-blocking)', async () => {
    mockGetDb.mockImplementation(() => { throw new Error('firebase down'); });
    const result = await getGlobalInsights({ title: 'some task' });
    expect(result).toBe('');
  });

  it('returns empty string when no keywords match any pattern', async () => {
    const patterns = {
      p1: { text: 'use memoization for expensive computations', universalityScore: 0.8, projectsSeenIn: {} },
    };
    mockGetDb.mockReturnValue({ ref: makeRef(patterns, null) });

    const result = await getGlobalInsights({ title: 'add delete button' });
    expect(result).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getGlobalModelRecommendation
// ─────────────────────────────────────────────────────────────────────────────

describe('getGlobalModelRecommendation', () => {
  it('returns null when Firebase has no data', async () => {
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => null }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    const result = await getGlobalModelRecommendation('coder', 'claude');
    expect(result).toBeNull();
  });

  it('returns null for unknown CLI family', async () => {
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => ({ 'some-model': {} }) }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    const result = await getGlobalModelRecommendation('coder', 'unknown-cli');
    expect(result).toBeNull();
  });

  it('returns null when model has fewer than 3 tasks', async () => {
    const data = {
      'claude-sonnet': { coder: { model: 'sonnet', avgSuccessRate: 0.9, taskCount: 2 } },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => data }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    const result = await getGlobalModelRecommendation('coder', 'claude');
    expect(result).toBeNull();
  });

  it('returns model with highest avgSuccessRate for given role and cli', async () => {
    const data = {
      'claude-haiku': { coder: { model: 'haiku', avgSuccessRate: 0.5, taskCount: 5 } },
      'claude-sonnet': { coder: { model: 'sonnet', avgSuccessRate: 0.85, taskCount: 10 } },
      'claude-opus': { coder: { model: 'opus', avgSuccessRate: 0.7, taskCount: 4 } },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => data }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    const result = await getGlobalModelRecommendation('coder', 'claude');
    expect(result).toBe('sonnet');
  });

  it('ignores models from a different CLI family', async () => {
    const data = {
      'o4-mini': { coder: { model: 'o4-mini', avgSuccessRate: 0.95, taskCount: 8 } },
      'claude-sonnet': { coder: { model: 'sonnet', avgSuccessRate: 0.8, taskCount: 5 } },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => data }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    const result = await getGlobalModelRecommendation('coder', 'claude');
    expect(result).toBe('sonnet');
  });

  it('ignores entries with no data for the requested role', async () => {
    const data = {
      'claude-haiku': { reviewer: { model: 'haiku', avgSuccessRate: 0.9, taskCount: 5 } },
    };
    const mockRef = { once: vi.fn().mockResolvedValue({ val: () => data }) };
    mockGetDb.mockReturnValue({ ref: vi.fn().mockReturnValue(mockRef) });
    const result = await getGlobalModelRecommendation('coder', 'claude');
    expect(result).toBeNull();
  });

  it('returns null on Firebase error (non-blocking)', async () => {
    mockGetDb.mockImplementation(() => { throw new Error('firebase down'); });
    const result = await getGlobalModelRecommendation('coder', 'claude');
    expect(result).toBeNull();
  });
});
