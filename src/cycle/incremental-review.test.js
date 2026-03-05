import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    incrementalReview: true,
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

import { config } from '../config.js';
import {
  shouldUseIncrementalReview,
  formatPreviousIssues,
  buildIncrementalPromptSection,
  calculateSavings,
  estimateTokens,
} from './incremental-review.js';

describe('incremental-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.incrementalReview = true;
  });

  describe('shouldUseIncrementalReview', () => {
    it('returns false for cycle 1 (first review)', () => {
      expect(shouldUseIncrementalReview(1)).toBe(false);
    });

    it('returns true for cycle 2+ when enabled', () => {
      expect(shouldUseIncrementalReview(2)).toBe(true);
      expect(shouldUseIncrementalReview(3)).toBe(true);
      expect(shouldUseIncrementalReview(5)).toBe(true);
    });

    it('returns false when config.incrementalReview is false', () => {
      config.incrementalReview = false;
      expect(shouldUseIncrementalReview(2)).toBe(false);
      expect(shouldUseIncrementalReview(3)).toBe(false);
    });
  });

  describe('formatPreviousIssues', () => {
    it('returns default message when no previous review', () => {
      expect(formatPreviousIssues(null)).toBe('No previous issues recorded.');
      expect(formatPreviousIssues({})).toBe('No previous issues recorded.');
      expect(formatPreviousIssues({ issues: [] })).toBe('No previous issues recorded.');
    });

    it('formats string issues', () => {
      const review = {
        score: 5,
        issues: ['Missing error handling', 'No tests'],
      };
      const result = formatPreviousIssues(review);
      expect(result).toContain('2 issue(s)');
      expect(result).toContain('score: 5/10');
      expect(result).toContain('1. Missing error handling');
      expect(result).toContain('2. No tests');
    });

    it('formats object issues with severity, file, line, and suggestion', () => {
      const review = {
        score: 4,
        issues: [
          {
            severity: 'critical',
            description: 'SQL injection vulnerability',
            file: 'src/db.js',
            line: 42,
            suggestion: 'Use parameterized queries',
          },
          {
            severity: 'minor',
            description: 'Variable naming',
            file: 'src/utils.js',
          },
        ],
      };
      const result = formatPreviousIssues(review);
      expect(result).toContain('[CRITICAL]');
      expect(result).toContain('SQL injection vulnerability');
      expect(result).toContain('(src/db.js:42)');
      expect(result).toContain('Fix: Use parameterized queries');
      expect(result).toContain('[MINOR]');
      expect(result).toContain('(src/utils.js)');
    });
  });

  describe('buildIncrementalPromptSection', () => {
    it('includes incremental review header and previous issues', () => {
      const context = {
        previousIssuesSummary: 'Previous review found 2 issue(s)',
        newFiles: [],
        incrementalDiffTokenEstimate: 500,
      };
      const result = buildIncrementalPromptSection(context);
      expect(result).toContain('INCREMENTAL REVIEW MODE');
      expect(result).toContain('Previous Issues to Verify');
      expect(result).toContain('Previous review found 2 issue(s)');
      expect(result).not.toContain('New Files Added');
    });

    it('includes new files section when present', () => {
      const context = {
        previousIssuesSummary: 'Issues summary',
        newFiles: ['src/new-helper.js', 'src/new-test.js'],
        incrementalDiffTokenEstimate: 800,
      };
      const result = buildIncrementalPromptSection(context);
      expect(result).toContain('New Files Added in Fix');
      expect(result).toContain('- src/new-helper.js');
      expect(result).toContain('- src/new-test.js');
    });
  });

  describe('calculateSavings', () => {
    it('calculates token savings correctly', () => {
      const result = calculateSavings(10000, 2000);
      expect(result.tokensSaved).toBe(8000);
      expect(result.percentageSaved).toBe(80);
    });

    it('handles zero full diff tokens', () => {
      const result = calculateSavings(0, 0);
      expect(result.tokensSaved).toBe(0);
      expect(result.percentageSaved).toBe(0);
    });

    it('does not return negative savings', () => {
      const result = calculateSavings(100, 500);
      expect(result.tokensSaved).toBe(0);
      expect(result.percentageSaved).toBe(0);
    });

    it('rounds percentage correctly', () => {
      const result = calculateSavings(3000, 1000);
      expect(result.percentageSaved).toBe(67);
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcdefgh')).toBe(2);
      expect(estimateTokens('a')).toBe(1); // ceil
    });

    it('returns 0 for empty/null input', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });
  });

  describe('full vs incremental comparison', () => {
    it('incremental review produces smaller token estimate than full review', () => {
      // Simulate a full PR diff (~40KB)
      const fullDiff = 'a'.repeat(40000);
      const fullTokens = estimateTokens(fullDiff);

      // Simulate a fix commit diff (~5KB)
      const fixDiff = 'b'.repeat(5000);
      const incrementalTokens = estimateTokens(fixDiff);

      const savings = calculateSavings(fullTokens, incrementalTokens);

      expect(savings.tokensSaved).toBeGreaterThan(0);
      expect(savings.percentageSaved).toBeGreaterThan(50);
      expect(incrementalTokens).toBeLessThan(fullTokens);
    });
  });
});
