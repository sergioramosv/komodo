import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateGuardianGates, GUARDIAN_GATE_IDS } from './guardian-gates.js';

// Mock config module
vi.mock('../config.js', () => ({
  config: {
    guardianMaxDiffLines: 500,
    guardianMaxTokenUsage: 80000,
    guardianMaxReviewCycles: 3,
    guardianEnableLargeDiff: true,
    guardianEnableSecurityFiles: true,
    guardianEnableHighTokenUsage: true,
    guardianEnableReviewCycles: true,
    guardianEnableDatabaseMigration: true,
    guardianEnableDependencyChange: true,
  },
}));

describe('evaluateGuardianGates', () => {
  describe('empty context', () => {
    it('returns no pause when context is empty', () => {
      const result = evaluateGuardianGates();
      expect(result.shouldPause).toBe(false);
      expect(result.triggeredGates).toHaveLength(0);
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe('large-diff gate', () => {
    it('triggers when diffLines exceeds threshold', () => {
      const result = evaluateGuardianGates({ diffLines: 501 });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.LARGE_DIFF);
      expect(result.shouldPause).toBe(true);
    });

    it('does not trigger at exactly the threshold', () => {
      const result = evaluateGuardianGates({ diffLines: 500 });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.LARGE_DIFF);
    });

    it('does not trigger below threshold', () => {
      const result = evaluateGuardianGates({ diffLines: 100 });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.LARGE_DIFF);
    });

    it('does not trigger when diffLines is null', () => {
      const result = evaluateGuardianGates({ diffLines: null });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.LARGE_DIFF);
    });

    it('does not trigger when disabled via config', async () => {
      const { config } = await import('../config.js');
      config.guardianEnableLargeDiff = false;
      const result = evaluateGuardianGates({ diffLines: 1000 });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.LARGE_DIFF);
      config.guardianEnableLargeDiff = true;
    });
  });

  describe('security-files gate', () => {
    it('triggers for auth-related files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['src/auth/login.js'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.SECURITY_FILES);
    });

    it('triggers for .env files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['.env.production'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.SECURITY_FILES);
    });

    it('triggers for jwt-related files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['utils/jwt-helper.js'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.SECURITY_FILES);
    });

    it('does not trigger for unrelated files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['src/components/Button.jsx'] });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.SECURITY_FILES);
    });

    it('does not trigger when filesChanged is empty', () => {
      const result = evaluateGuardianGates({ filesChanged: [] });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.SECURITY_FILES);
    });

    it('does not trigger when disabled via config', async () => {
      const { config } = await import('../config.js');
      config.guardianEnableSecurityFiles = false;
      const result = evaluateGuardianGates({ filesChanged: ['src/auth/login.js'] });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.SECURITY_FILES);
      config.guardianEnableSecurityFiles = true;
    });
  });

  describe('high-token-usage gate', () => {
    it('triggers when usedTokens exceeds threshold', () => {
      const result = evaluateGuardianGates({ usedTokens: 80001 });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.HIGH_TOKEN_USAGE);
      expect(result.shouldPause).toBe(true);
    });

    it('does not trigger at exactly the threshold', () => {
      const result = evaluateGuardianGates({ usedTokens: 80000 });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.HIGH_TOKEN_USAGE);
    });

    it('does not trigger below threshold', () => {
      const result = evaluateGuardianGates({ usedTokens: 50000 });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.HIGH_TOKEN_USAGE);
    });

    it('does not trigger when usedTokens is null', () => {
      const result = evaluateGuardianGates({ usedTokens: null });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.HIGH_TOKEN_USAGE);
    });

    it('does not trigger when disabled via config', async () => {
      const { config } = await import('../config.js');
      config.guardianEnableHighTokenUsage = false;
      const result = evaluateGuardianGates({ usedTokens: 100000 });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.HIGH_TOKEN_USAGE);
      config.guardianEnableHighTokenUsage = true;
    });
  });

  describe('review-cycles gate', () => {
    it('triggers when reviewCycles reaches threshold', () => {
      const result = evaluateGuardianGates({ reviewCycles: 3 });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.REVIEW_CYCLES);
    });

    it('triggers when reviewCycles exceeds threshold', () => {
      const result = evaluateGuardianGates({ reviewCycles: 5 });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.REVIEW_CYCLES);
    });

    it('does not trigger below threshold', () => {
      const result = evaluateGuardianGates({ reviewCycles: 2 });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.REVIEW_CYCLES);
    });

    it('does not trigger when reviewCycles is null', () => {
      const result = evaluateGuardianGates({ reviewCycles: null });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.REVIEW_CYCLES);
    });

    it('does not trigger when disabled via config', async () => {
      const { config } = await import('../config.js');
      config.guardianEnableReviewCycles = false;
      const result = evaluateGuardianGates({ reviewCycles: 10 });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.REVIEW_CYCLES);
      config.guardianEnableReviewCycles = true;
    });
  });

  describe('database-migration gate', () => {
    it('triggers for migration files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['db/migrations/001_create_users.sql'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.DATABASE_MIGRATION);
    });

    it('triggers for .sql files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['scripts/seed.sql'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.DATABASE_MIGRATION);
    });

    it('triggers for prisma migration files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['prisma/migrations/20240101_init.js'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.DATABASE_MIGRATION);
    });

    it('does not trigger for unrelated files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['src/utils/helpers.js'] });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.DATABASE_MIGRATION);
    });

    it('does not trigger when disabled via config', async () => {
      const { config } = await import('../config.js');
      config.guardianEnableDatabaseMigration = false;
      const result = evaluateGuardianGates({ filesChanged: ['db/migrations/001.sql'] });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.DATABASE_MIGRATION);
      config.guardianEnableDatabaseMigration = true;
    });
  });

  describe('dependency-change gate', () => {
    it('triggers for package.json', () => {
      const result = evaluateGuardianGates({ filesChanged: ['package.json'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.DEPENDENCY_CHANGE);
    });

    it('triggers for package-lock.json', () => {
      const result = evaluateGuardianGates({ filesChanged: ['package-lock.json'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.DEPENDENCY_CHANGE);
    });

    it('triggers for yarn.lock', () => {
      const result = evaluateGuardianGates({ filesChanged: ['yarn.lock'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.DEPENDENCY_CHANGE);
    });

    it('triggers for go.mod in subdirectory', () => {
      const result = evaluateGuardianGates({ filesChanged: ['services/api/go.mod'] });
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.DEPENDENCY_CHANGE);
    });

    it('does not trigger for non-dependency files', () => {
      const result = evaluateGuardianGates({ filesChanged: ['src/index.js'] });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.DEPENDENCY_CHANGE);
    });

    it('does not trigger when disabled via config', async () => {
      const { config } = await import('../config.js');
      config.guardianEnableDependencyChange = false;
      const result = evaluateGuardianGates({ filesChanged: ['package.json'] });
      expect(result.triggeredGates).not.toContain(GUARDIAN_GATE_IDS.DEPENDENCY_CHANGE);
      config.guardianEnableDependencyChange = true;
    });
  });

  describe('multiple gates', () => {
    it('triggers multiple gates simultaneously', () => {
      const result = evaluateGuardianGates({
        diffLines: 1000,
        filesChanged: ['src/auth/login.js', 'package.json'],
        usedTokens: 100000,
        reviewCycles: 4,
      });
      expect(result.shouldPause).toBe(true);
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.LARGE_DIFF);
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.SECURITY_FILES);
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.HIGH_TOKEN_USAGE);
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.REVIEW_CYCLES);
      expect(result.triggeredGates).toContain(GUARDIAN_GATE_IDS.DEPENDENCY_CHANGE);
      expect(result.reasons).toHaveLength(result.triggeredGates.length);
    });

    it('does not pause when all values are within thresholds', () => {
      const result = evaluateGuardianGates({
        diffLines: 100,
        filesChanged: ['src/components/Button.jsx'],
        usedTokens: 5000,
        reviewCycles: 1,
      });
      expect(result.shouldPause).toBe(false);
      expect(result.triggeredGates).toHaveLength(0);
    });
  });

  describe('reasons array', () => {
    it('provides a reason for each triggered gate', () => {
      const result = evaluateGuardianGates({ diffLines: 600, usedTokens: 90000 });
      expect(result.reasons).toHaveLength(result.triggeredGates.length);
      result.reasons.forEach((reason) => {
        expect(typeof reason).toBe('string');
        expect(reason.length).toBeGreaterThan(0);
      });
    });
  });
});
