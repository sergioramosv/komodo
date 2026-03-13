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

import { evaluatePatternUniversality, syncPatternsToGlobal, syncModelPerformanceToGlobal, getGlobalPatterns, getGlobalAntiPatterns, applyGlobalAntiPatternsToProject } from './cross-project-intelligence.js';

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
