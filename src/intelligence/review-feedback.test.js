import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const { mockReadFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    memoryDir: '/mock/memory',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
}));

import {
  readPatterns,
  calculateDecayWeight,
  calculatePatternScore,
  getTopPatterns,
  extractTaskKeywords,
  scorePatternRelevance,
  getReviewFeedbackContext,
  findAvoidedPatterns,
} from './review-feedback.js';

beforeEach(() => {
  vi.resetAllMocks();
});

// --- Helper: create mock patterns store ---

function mockStore(patterns) {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify({
    patterns,
    reviewOutcomes: [],
  }));
}

function makePattern(overrides = {}) {
  const today = new Date().toISOString().split('T')[0];
  return {
    id: 'test-id',
    type: 'error',
    description: 'Missing error handling in async function',
    tags: ['error-handling', 'async'],
    severity: 'high',
    resolution: 'Always wrap async calls in try/catch',
    frequency: 5,
    firstSeen: today,
    lastSeen: today,
    taskId: null,
    prNumber: null,
    ...overrides,
  };
}

// --- readPatterns ---

describe('readPatterns', () => {
  it('returns patterns from store file', () => {
    const patterns = [makePattern()];
    mockStore(patterns);

    const result = readPatterns();
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('Missing error handling in async function');
  });

  it('returns empty array when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = readPatterns();
    expect(result).toEqual([]);
  });

  it('returns empty array on parse error', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('invalid json');

    const result = readPatterns();
    expect(result).toEqual([]);
  });
});

// --- calculateDecayWeight ---

describe('calculateDecayWeight', () => {
  it('returns 1.0 for recent patterns (< 30 days)', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(calculateDecayWeight(today)).toBe(1.0);
  });

  it('returns 1.0 for patterns exactly 30 days old', () => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    expect(calculateDecayWeight(date.toISOString().split('T')[0])).toBe(1.0);
  });

  it('returns value between 0.1 and 1.0 for patterns 31-89 days old', () => {
    const date = new Date();
    date.setDate(date.getDate() - 60);
    const weight = calculateDecayWeight(date.toISOString().split('T')[0]);
    expect(weight).toBeGreaterThan(0.1);
    expect(weight).toBeLessThan(1.0);
  });

  it('returns 0.1 for patterns >= 90 days old', () => {
    const date = new Date();
    date.setDate(date.getDate() - 90);
    expect(calculateDecayWeight(date.toISOString().split('T')[0])).toBe(0.1);
  });

  it('returns 0.5 for null lastSeen', () => {
    expect(calculateDecayWeight(null)).toBe(0.5);
  });
});

// --- calculatePatternScore ---

describe('calculatePatternScore', () => {
  it('scores high-severity frequent recent patterns highest', () => {
    const today = new Date().toISOString().split('T')[0];
    const pattern = makePattern({ severity: 'high', frequency: 10, lastSeen: today });
    const score = calculatePatternScore(pattern);
    // 10 * 3 * 1.0 = 30
    expect(score).toBe(30);
  });

  it('scores low-severity infrequent patterns lowest', () => {
    const today = new Date().toISOString().split('T')[0];
    const pattern = makePattern({ severity: 'low', frequency: 1, lastSeen: today });
    const score = calculatePatternScore(pattern);
    // 1 * 1 * 1.0 = 1
    expect(score).toBe(1);
  });

  it('applies time decay to old patterns', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);
    const pattern = makePattern({ severity: 'high', frequency: 10, lastSeen: oldDate.toISOString().split('T')[0] });
    const score = calculatePatternScore(pattern);
    // 10 * 3 * 0.1 = 3
    expect(score).toBe(3);
  });
});

// --- getTopPatterns ---

describe('getTopPatterns', () => {
  it('returns top patterns sorted by score', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'Low priority', severity: 'low', frequency: 1, lastSeen: today }),
      makePattern({ id: '2', description: 'High priority', severity: 'high', frequency: 10, lastSeen: today }),
      makePattern({ id: '3', description: 'Medium priority', severity: 'medium', frequency: 5, lastSeen: today }),
    ]);

    const result = getTopPatterns({ limit: 3 });

    expect(result).toHaveLength(3);
    expect(result[0].pattern.description).toBe('High priority');
    expect(result[1].pattern.description).toBe('Medium priority');
    expect(result[2].pattern.description).toBe('Low priority');
  });

  it('respects the limit parameter', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'A', lastSeen: today }),
      makePattern({ id: '2', description: 'B', lastSeen: today }),
      makePattern({ id: '3', description: 'C', lastSeen: today }),
    ]);

    const result = getTopPatterns({ limit: 2 });
    expect(result).toHaveLength(2);
  });

  it('excludes positive and style patterns', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', type: 'positive', description: 'Good pattern', lastSeen: today }),
      makePattern({ id: '2', type: 'style', description: 'Style issue', lastSeen: today }),
      makePattern({ id: '3', type: 'error', description: 'Real error', lastSeen: today }),
    ]);

    const result = getTopPatterns({ limit: 5 });
    expect(result).toHaveLength(1);
    expect(result[0].pattern.type).toBe('error');
  });

  it('returns empty array when no patterns exist', () => {
    mockStore([]);
    expect(getTopPatterns()).toEqual([]);
  });

  it('includes percentage based on frequency', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'Frequent', frequency: 8, lastSeen: today }),
      makePattern({ id: '2', description: 'Rare', frequency: 2, lastSeen: today }),
    ]);

    const result = getTopPatterns({ limit: 5 });
    expect(result[0].percentage).toBe(80);
    expect(result[1].percentage).toBe(20);
  });
});

// --- extractTaskKeywords ---

describe('extractTaskKeywords', () => {
  it('returns empty array for null taskSpec', () => {
    expect(extractTaskKeywords(null)).toEqual([]);
  });

  it('returns empty array for undefined taskSpec', () => {
    expect(extractTaskKeywords(undefined)).toEqual([]);
  });

  it('extracts keywords from title and userStory', () => {
    const taskSpec = {
      title: 'Add authentication middleware',
      userStory: { what: 'secure endpoints', why: 'prevent unauthorized access' },
      acceptanceCriteria: ['validate tokens'],
    };

    const keywords = extractTaskKeywords(taskSpec);
    expect(keywords).toContain('authentication');
    expect(keywords).toContain('middleware');
    expect(keywords).toContain('secure');
    expect(keywords).toContain('endpoints');
    expect(keywords).toContain('validate');
    expect(keywords).toContain('tokens');
  });

  it('filters out short words (length <= 3)', () => {
    const taskSpec = { title: 'Add a new API endpoint' };

    const keywords = extractTaskKeywords(taskSpec);
    expect(keywords).not.toContain('add');
    expect(keywords).not.toContain('new');
    expect(keywords).not.toContain('api');
    expect(keywords).toContain('endpoint');
  });

  it('deduplicates keywords', () => {
    const taskSpec = {
      title: 'authentication authentication',
      userStory: { what: 'authentication' },
    };

    const keywords = extractTaskKeywords(taskSpec);
    const authCount = keywords.filter(k => k === 'authentication').length;
    expect(authCount).toBe(1);
  });

  it('handles taskSpec with missing optional fields', () => {
    const taskSpec = { title: 'Some feature' };

    const keywords = extractTaskKeywords(taskSpec);
    expect(keywords).toContain('some');
    expect(keywords).toContain('feature');
  });
});

// --- scorePatternRelevance ---

describe('scorePatternRelevance', () => {
  it('returns 1 when no task keywords provided (empty array)', () => {
    const pattern = makePattern({ description: 'Some error', tags: ['testing'] });
    expect(scorePatternRelevance(pattern, [])).toBe(1);
  });

  it('scores based on keyword matches in description', () => {
    const pattern = makePattern({ description: 'Missing error handling in async function', tags: [] });
    const score = scorePatternRelevance(pattern, ['error', 'handling', 'unrelated']);

    expect(score).toBe(2); // 'error' and 'handling' match
  });

  it('scores based on keyword matches in tags', () => {
    const pattern = makePattern({ description: 'Some issue', tags: ['authentication', 'middleware'] });
    const score = scorePatternRelevance(pattern, ['authentication', 'database']);

    expect(score).toBe(1); // 'authentication' matches in tags
  });

  it('returns 0 when no keywords match', () => {
    const pattern = makePattern({ description: 'Missing error handling', tags: ['async'] });
    const score = scorePatternRelevance(pattern, ['database', 'migration']);

    expect(score).toBe(0);
  });

  it('handles pattern without tags', () => {
    const pattern = { description: 'Some error', tags: undefined };
    const score = scorePatternRelevance(pattern, ['error']);

    expect(score).toBe(1);
  });
});

// --- getReviewFeedbackContext ---

describe('getReviewFeedbackContext', () => {
  it('returns summary and pattern count', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'Error A', frequency: 5, lastSeen: today }),
    ]);

    const { summary, patternCount } = getReviewFeedbackContext();
    expect(summary).toContain('COMMON MISTAKES TO AVOID:');
    expect(patternCount).toBe(1);
  });

  it('returns empty when no patterns exist', () => {
    mockStore([]);

    const { summary, patternCount } = getReviewFeedbackContext();
    expect(summary).toBe('');
    expect(patternCount).toBe(0);
  });

  it('handles null taskSpec gracefully', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'Error A', frequency: 5, lastSeen: today }),
    ]);

    const { summary, patternCount } = getReviewFeedbackContext({ taskSpec: null });
    expect(summary).toContain('COMMON MISTAKES TO AVOID:');
    expect(patternCount).toBe(1);
  });

  it('filters patterns by task relevance when taskSpec is provided', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'Missing error handling in async', tags: ['async'], frequency: 3, lastSeen: today }),
      makePattern({ id: '2', description: 'No unit tests for database queries', tags: ['testing', 'database'], frequency: 3, lastSeen: today }),
      makePattern({ id: '3', description: 'SQL injection vulnerability', tags: ['security', 'database'], frequency: 3, lastSeen: today }),
    ]);

    const { summary, patternCount } = getReviewFeedbackContext({
      taskSpec: { title: 'Fix database connection pooling' },
    });

    expect(patternCount).toBeGreaterThan(0);
    expect(summary).toContain('COMMON MISTAKES TO AVOID:');
  });

  it('handles mixed issue types (only errors and anti-patterns)', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', type: 'error', description: 'Real error', frequency: 5, lastSeen: today }),
      makePattern({ id: '2', type: 'positive', description: 'Good practice', frequency: 10, lastSeen: today }),
      makePattern({ id: '3', type: 'anti-pattern', description: 'Bad practice', frequency: 3, lastSeen: today }),
      makePattern({ id: '4', type: 'style', description: 'Style issue', frequency: 8, lastSeen: today }),
    ]);

    const { summary, patternCount } = getReviewFeedbackContext();
    // Only error and anti-pattern should be included
    expect(patternCount).toBe(2);
    expect(summary).toContain('Real error');
    expect(summary).toContain('Bad practice');
    expect(summary).not.toContain('Good practice');
    expect(summary).not.toContain('Style issue');
  });
});

// --- findAvoidedPatterns ---

describe('findAvoidedPatterns', () => {
  it('returns patterns not matching any review issues', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'Missing error handling', tags: ['error-handling'], frequency: 5, lastSeen: today }),
      makePattern({ id: '2', description: 'No unit tests', tags: ['testing'], frequency: 3, lastSeen: today }),
    ]);

    // Only "missing error handling" appears in issues, so "no unit tests" is avoided
    const issues = [
      { severity: 'minor', description: 'Missing error handling in fetchData' },
    ];

    const avoided = findAvoidedPatterns(issues);
    expect(avoided).toHaveLength(1);
    expect(avoided[0].description).toBe('No unit tests');
  });

  it('returns all patterns when no issues match', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'Missing error handling', frequency: 5, lastSeen: today }),
      makePattern({ id: '2', description: 'No unit tests', frequency: 3, lastSeen: today }),
    ]);

    const avoided = findAvoidedPatterns([]);
    expect(avoided).toHaveLength(2);
  });

  it('returns empty when no patterns exist', () => {
    mockStore([]);
    expect(findAvoidedPatterns([])).toEqual([]);
  });

  it('detects matches via tag overlap', () => {
    const today = new Date().toISOString().split('T')[0];
    mockStore([
      makePattern({ id: '1', description: 'Async issues', tags: ['async', 'error-handling'], frequency: 5, lastSeen: today }),
    ]);

    // Issue mentions "async" tag
    const issues = [{ severity: 'major', description: 'Problem with async handling' }];

    const avoided = findAvoidedPatterns(issues);
    expect(avoided).toHaveLength(0); // Pattern was NOT avoided, issue matches tag
  });
});
