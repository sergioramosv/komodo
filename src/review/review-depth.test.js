import { describe, it, expect } from 'vitest';
import { REVIEW_DEPTHS, selectReviewDepth } from './review-depth.js';

describe('selectReviewDepth', () => {
  // ── forensic ───────────────────────────────────────────

  it('returns forensic when sonarReport has BLOCKER issues count', () => {
    const result = selectReviewDepth({
      sonarReport: { success: true, issues: { BLOCKER: 2 } },
    });
    expect(result.depth).toBe('forensic');
    expect(result.model).toBe(REVIEW_DEPTHS.forensic.model);
  });

  it('returns forensic when sonarReport has CRITICAL VULNERABILITY detail', () => {
    const result = selectReviewDepth({
      sonarReport: {
        success: true,
        issues: { BLOCKER: 0 },
        issueDetails: [{ severity: 'CRITICAL', type: 'VULNERABILITY' }],
      },
    });
    expect(result.depth).toBe('forensic');
  });

  it('returns forensic when sonarReport has BLOCKER VULNERABILITY detail', () => {
    const result = selectReviewDepth({
      sonarReport: {
        success: true,
        issues: { BLOCKER: 0 },
        issueDetails: [{ severity: 'BLOCKER', type: 'VULNERABILITY' }],
      },
    });
    expect(result.depth).toBe('forensic');
  });

  it('does not return forensic when sonarReport.success is false', () => {
    const result = selectReviewDepth({
      devPoints: 1,
      filesChanged: [],
      sonarReport: { success: false, issues: { BLOCKER: 5 } },
    });
    expect(result.depth).not.toBe('forensic');
  });

  // ── deep ───────────────────────────────────────────────

  it('returns deep when a sensitive file is changed', () => {
    const result = selectReviewDepth({
      filesChanged: ['src/auth/login.js'],
    });
    expect(result.depth).toBe('deep');
    expect(result.model).toBe(REVIEW_DEPTHS.deep.model);
  });

  it('returns deep for payment file path', () => {
    const result = selectReviewDepth({
      filesChanged: ['src/payment/stripe.js'],
    });
    expect(result.depth).toBe('deep');
  });

  // ── quick ──────────────────────────────────────────────

  it('returns quick when devPoints<=2 and filesChanged<=3', () => {
    const result = selectReviewDepth({
      devPoints: 2,
      filesChanged: ['a.js', 'b.js'],
    });
    expect(result.depth).toBe('quick');
    expect(result.model).toBe(REVIEW_DEPTHS.quick.model);
  });

  it('does not return quick when devPoints>2', () => {
    const result = selectReviewDepth({
      devPoints: 3,
      filesChanged: ['a.js'],
    });
    expect(result.depth).toBe('standard');
  });

  it('does not return quick when filesChanged>3', () => {
    const result = selectReviewDepth({
      devPoints: 1,
      filesChanged: ['a.js', 'b.js', 'c.js', 'd.js'],
    });
    expect(result.depth).toBe('standard');
  });

  // ── standard ───────────────────────────────────────────

  it('returns standard by default', () => {
    const result = selectReviewDepth();
    expect(result.depth).toBe('standard');
    expect(result.model).toBe(REVIEW_DEPTHS.standard.model);
  });

  it('returns standard for medium complexity tasks', () => {
    const result = selectReviewDepth({
      devPoints: 5,
      filesChanged: ['a.js', 'b.js'],
    });
    expect(result.depth).toBe('standard');
  });

  // ── priority order ────────────────────────────────────

  it('forensic takes priority over deep (sensitive file + critical sonar)', () => {
    const result = selectReviewDepth({
      filesChanged: ['src/auth/login.js'],
      sonarReport: {
        success: true,
        issueDetails: [{ severity: 'BLOCKER', type: 'VULNERABILITY' }],
      },
    });
    expect(result.depth).toBe('forensic');
  });

  it('deep takes priority over quick (sensitive file + low devPoints)', () => {
    const result = selectReviewDepth({
      devPoints: 1,
      filesChanged: ['src/crypto/hash.js'],
    });
    expect(result.depth).toBe('deep');
  });

  // ── result shape ──────────────────────────────────────

  it('includes all expected properties in result', () => {
    const result = selectReviewDepth();
    expect(result).toHaveProperty('depth');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('estimatedMaxTokens');
    expect(result).toHaveProperty('maxTurns');
    expect(result).toHaveProperty('criteria');
    expect(Array.isArray(result.criteria)).toBe(true);
  });
});

describe('isSensitiveFile (via selectReviewDepth)', () => {
  const sensitivePatterns = [
    'auth', 'payment', 'billing', 'crypto', 'secret',
    'token', 'password', 'credential', 'wallet', 'checkout', 'invoice',
  ];

  for (const pattern of sensitivePatterns) {
    it(`detects "${pattern}" as sensitive`, () => {
      const result = selectReviewDepth({
        devPoints: 1,
        filesChanged: [`src/${pattern}/index.js`],
      });
      expect(result.depth).toBe('deep');
    });
  }

  it('is case-insensitive', () => {
    const result = selectReviewDepth({
      devPoints: 1,
      filesChanged: ['src/AUTH/Login.js'],
    });
    expect(result.depth).toBe('deep');
  });

  it('handles non-string filePath gracefully (no crash)', () => {
    const result = selectReviewDepth({
      devPoints: 1,
      filesChanged: [null, undefined, 42],
    });
    expect(result.depth).toBe('quick');
  });
});
