import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockReadFileSync, mockWriteFileSync, mockExistsSync, mockMkdirSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('../config.js', () => ({
  config: { knowledgeDir: '/mock/knowledge' },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { updateLearning, buildLearningContext } from './codebase-learning.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockMkdirSync.mockReturnValue(undefined);
  mockWriteFileSync.mockReturnValue(undefined);
});

// --- Helpers ---

function makeStore(overrides = {}) {
  return JSON.stringify({ patterns: [], antiPatterns: [], updatedAt: null, ...overrides });
}

function capturedStore() {
  const raw = mockWriteFileSync.mock.calls[0]?.[1];
  return raw ? JSON.parse(raw) : null;
}

// --- updateLearning ---

describe('updateLearning', () => {
  it('does nothing when projectId is missing', () => {
    updateLearning(null, 'task-1', { approved: true, positives: ['good pattern'] });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('does nothing when reviewOutcome is missing', () => {
    updateLearning('proj-1', 'task-1', null);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('adds positives as patterns on approval', () => {
    mockExistsSync.mockReturnValue(false);

    updateLearning('proj-1', 'task-1', {
      approved: true,
      positives: ['Uses dependency injection', 'Clean error handling'],
    });

    const store = capturedStore();
    expect(store.patterns).toContain('Uses dependency injection');
    expect(store.patterns).toContain('Clean error handling');
    expect(store.antiPatterns).toHaveLength(0);
  });

  it('adds issues as anti-patterns on rejection', () => {
    mockExistsSync.mockReturnValue(false);

    updateLearning('proj-1', 'task-1', {
      approved: false,
      issues: [
        { description: 'Missing error handling' },
        { message: 'No input validation' },
      ],
    });

    const store = capturedStore();
    expect(store.antiPatterns).toContain('Missing error handling');
    expect(store.antiPatterns).toContain('No input validation');
    expect(store.patterns).toHaveLength(0);
  });

  it('adds [convention] prefix when issue text mentions naming conventions', () => {
    updateLearning('proj-1', 'task-1', {
      approved: false,
      issues: [{ description: 'Inconsistent naming: use camelCase' }],
    });

    const store = capturedStore();
    expect(store.antiPatterns[0]).toBe('[convention] Inconsistent naming: use camelCase');
  });

  it('adds [convention] prefix when issue text mentions estilo', () => {
    updateLearning('proj-1', 'task-1', {
      approved: false,
      issues: [{ description: 'Fallo de estilo en la función' }],
    });

    const store = capturedStore();
    expect(store.antiPatterns[0]).toMatch(/^\[convention\]/);
  });

  it('adds [convention] prefix when issue text mentions indent', () => {
    updateLearning('proj-1', 'task-1', {
      approved: false,
      issues: [{ description: 'Wrong indentation in block' }],
    });

    const store = capturedStore();
    expect(store.antiPatterns[0]).toMatch(/^\[convention\]/);
  });

  it('does NOT add [convention] prefix for unrelated issues', () => {
    updateLearning('proj-1', 'task-1', {
      approved: false,
      issues: [{ description: 'Missing semicolons' }],
      error: 'Review no aprobada',  // orchestration error — must NOT trigger convention detection
    });

    const store = capturedStore();
    expect(store.antiPatterns[0]).toBe('Missing semicolons');
  });

  it('does NOT use the error field for convention detection', () => {
    // Even if error mentions "convention", issues without convention keywords must NOT be prefixed
    updateLearning('proj-1', 'task-1', {
      approved: false,
      issues: [{ description: 'Missing tests' }],
      error: 'convención de código violada',
    });

    const store = capturedStore();
    expect(store.antiPatterns[0]).toBe('Missing tests');
  });

  it('tags convention issues individually, not globally', () => {
    updateLearning('proj-1', 'task-1', {
      approved: false,
      issues: [
        { description: 'Bad naming convention for variables' },
        { description: 'Missing error handler' },
      ],
    });

    const store = capturedStore();
    expect(store.antiPatterns[0]).toMatch(/^\[convention\]/);
    expect(store.antiPatterns[1]).not.toMatch(/^\[convention\]/);
  });

  it('merges with existing store loaded from disk', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeStore({ patterns: ['Existing pattern'], antiPatterns: [] }),
    );

    updateLearning('proj-1', 'task-1', {
      approved: true,
      positives: ['New pattern'],
    });

    const store = capturedStore();
    expect(store.patterns).toContain('Existing pattern');
    expect(store.patterns).toContain('New pattern');
  });

  it('deduplicates patterns case-insensitively', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeStore({ patterns: ['Use dependency injection'], antiPatterns: [] }),
    );

    updateLearning('proj-1', 'task-1', {
      approved: true,
      positives: ['use dependency injection'],  // duplicate (different case)
    });

    const store = capturedStore();
    expect(store.patterns.filter((p) => /dependency injection/i.test(p))).toHaveLength(1);
  });

  it('deduplicates anti-patterns case-insensitively', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeStore({ patterns: [], antiPatterns: ['Missing tests'] }),
    );

    updateLearning('proj-1', 'task-1', {
      approved: false,
      issues: [{ description: 'missing tests' }],
    });

    const store = capturedStore();
    expect(store.antiPatterns.filter((a) => /missing tests/i.test(a))).toHaveLength(1);
  });

  it('trims patterns to MAX_ENTRIES_PER_CATEGORY (15)', () => {
    const existing = Array.from({ length: 15 }, (_, i) => `Pattern ${i}`);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeStore({ patterns: existing, antiPatterns: [] }));

    updateLearning('proj-1', 'task-1', {
      approved: true,
      positives: ['Brand new pattern'],
    });

    const store = capturedStore();
    expect(store.patterns.length).toBeLessThanOrEqual(15);
    // The newest entry should be kept (slice from the end)
    expect(store.patterns).toContain('Brand new pattern');
  });

  it('handles corrupted store file gracefully', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('NOT JSON');

    // Should not throw; starts from empty store
    expect(() => {
      updateLearning('proj-1', 'task-1', { approved: true, positives: ['p'] });
    }).not.toThrow();

    const store = capturedStore();
    expect(store.patterns).toContain('p');
  });

  it('skips empty positives', () => {
    updateLearning('proj-1', 'task-1', {
      approved: true,
      positives: ['', null, 'Valid pattern'],
    });

    const store = capturedStore();
    expect(store.patterns).toEqual(['Valid pattern']);
  });

  it('writes updatedAt timestamp', () => {
    updateLearning('proj-1', 'task-1', { approved: true, positives: ['p'] });
    const store = capturedStore();
    expect(store.updatedAt).toBeTruthy();
    expect(new Date(store.updatedAt).getTime()).not.toBeNaN();
  });
});

// --- buildLearningContext ---

describe('buildLearningContext', () => {
  it('returns null when projectId is missing', () => {
    const result = buildLearningContext(null);
    expect(result).toBeNull();
  });

  it('returns null when store is empty', () => {
    mockExistsSync.mockReturnValue(false);
    const result = buildLearningContext('proj-1');
    expect(result).toBeNull();
  });

  it('returns formatted context with patterns', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeStore({ patterns: ['Use DI', 'Write tests'], antiPatterns: [] }),
    );

    const result = buildLearningContext('proj-1');
    expect(result).not.toBeNull();
    expect(result.learningContext).toContain('Proven patterns');
    expect(result.learningContext).toContain('Use DI');
    expect(result.stats.patterns).toBe(2);
    expect(result.stats.antiPatterns).toBe(0);
  });

  it('returns formatted context with anti-patterns', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeStore({ patterns: [], antiPatterns: ['Skip tests', 'God objects'] }),
    );

    const result = buildLearningContext('proj-1');
    expect(result).not.toBeNull();
    expect(result.learningContext).toContain('Anti-patterns');
    expect(result.learningContext).toContain('Skip tests');
    expect(result.stats.antiPatterns).toBe(2);
  });

  it('includes both sections when both are populated', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeStore({ patterns: ['Good pattern'], antiPatterns: ['Bad pattern'] }),
    );

    const result = buildLearningContext('proj-1');
    expect(result.learningContext).toContain('Proven patterns');
    expect(result.learningContext).toContain('Anti-patterns');
  });

  it('truncates context when it exceeds char limit', () => {
    // 10 entries × ~400 chars each ≈ 4000 chars > 3500 limit
    const longPatterns = Array.from({ length: 10 }, (_, i) =>
      `Pattern ${i}: ${'x'.repeat(400)}`,
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeStore({ patterns: longPatterns, antiPatterns: [] }));

    const result = buildLearningContext('proj-1');
    expect(result.learningContext.length).toBeLessThanOrEqual(3600); // ~limit + truncation suffix
    expect(result.learningContext).toContain('truncated');
  });

  it('handles store read errors gracefully', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => { throw new Error('disk error'); });

    const result = buildLearningContext('proj-1');
    // loadLearningStore returns empty store on error → buildLearningContext returns null
    expect(result).toBeNull();
  });
});
