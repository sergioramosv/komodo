import { config } from '../config.js';

/**
 * IDs for all available Guardian gates.
 */
export const GUARDIAN_GATE_IDS = {
  LARGE_DIFF: 'large-diff',
  SECURITY_FILES: 'security-files',
  HIGH_TOKEN_USAGE: 'high-token-usage',
  REVIEW_CYCLES: 'review-cycles',
  DATABASE_MIGRATION: 'database-migration',
  DEPENDENCY_CHANGE: 'dependency-change',
};

/**
 * File path patterns that trigger the security-files gate.
 */
const SECURITY_FILE_PATTERNS = [
  /auth/i,
  /secret/i,
  /credential/i,
  /password/i,
  /token/i,
  /\.env/i,
  /permission/i,
  /acl/i,
  /oauth/i,
  /jwt/i,
  /crypto/i,
  /encrypt/i,
  /key\.(js|ts|json)/i,
];

/**
 * File path patterns that trigger the database-migration gate.
 */
const DATABASE_MIGRATION_PATTERNS = [
  /migration/i,
  /migrate/i,
  /schema\.(js|ts|sql)/i,
  /\.sql$/i,
  /seed\.(js|ts)/i,
  /db\.(js|ts)/i,
  /database/i,
  /knexfile/i,
  /sequelize/i,
  /prisma\/migrations/i,
];

/**
 * File path patterns that trigger the dependency-change gate.
 */
const DEPENDENCY_CHANGE_PATTERNS = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^Gemfile/,
  /^requirements\.txt$/,
  /^go\.mod$/,
  /^go\.sum$/,
  /^Cargo\.toml$/,
  /^Cargo\.lock$/,
  /^pyproject\.toml$/,
  /^composer\.json$/,
];

/**
 * Checks if a file path matches any of the given patterns.
 *
 * @param {string} filePath
 * @param {RegExp[]} patterns
 * @returns {boolean}
 */
function matchesAny(filePath, patterns) {
  const normalized = filePath.replace(/\\/g, '/');
  return patterns.some((pattern) => pattern.test(normalized));
}

/**
 * Evaluates all enabled Guardian gates against the provided context.
 *
 * @param {Object} context - Contextual data about the current cycle
 * @param {number|null} [context.diffLines] - Total diff lines in the PR
 * @param {string[]} [context.filesChanged] - List of files changed in the PR
 * @param {number|null} [context.usedTokens] - Estimated tokens used in this cycle
 * @param {number|null} [context.reviewCycles] - Number of review cycles completed
 * @returns {{ shouldPause: boolean, triggeredGates: string[], reasons: string[] }}
 */
export function evaluateGuardianGates(context = {}) {
  const {
    diffLines = null,
    filesChanged = [],
    usedTokens = null,
    reviewCycles = null,
  } = context;

  const triggeredGates = [];
  const reasons = [];

  // Gate: large-diff
  if (config.guardianEnableLargeDiff && diffLines !== null && diffLines > config.guardianMaxDiffLines) {
    triggeredGates.push(GUARDIAN_GATE_IDS.LARGE_DIFF);
    reasons.push(
      `Diff size (${diffLines} lines) exceeds threshold (${config.guardianMaxDiffLines} lines)`,
    );
  }

  // Gate: security-files
  if (config.guardianEnableSecurityFiles && filesChanged.length > 0) {
    const securityMatches = filesChanged.filter((f) => matchesAny(f, SECURITY_FILE_PATTERNS));
    if (securityMatches.length > 0) {
      triggeredGates.push(GUARDIAN_GATE_IDS.SECURITY_FILES);
      reasons.push(`Security-sensitive files modified: ${securityMatches.join(', ')}`);
    }
  }

  // Gate: high-token-usage
  if (config.guardianEnableHighTokenUsage && usedTokens !== null && usedTokens > config.guardianMaxTokenUsage) {
    triggeredGates.push(GUARDIAN_GATE_IDS.HIGH_TOKEN_USAGE);
    reasons.push(
      `Token usage (${usedTokens}) exceeds threshold (${config.guardianMaxTokenUsage})`,
    );
  }

  // Gate: review-cycles
  if (
    config.guardianEnableReviewCycles &&
    reviewCycles !== null &&
    reviewCycles >= config.guardianMaxReviewCycles
  ) {
    triggeredGates.push(GUARDIAN_GATE_IDS.REVIEW_CYCLES);
    reasons.push(
      `Review cycles (${reviewCycles}) reached threshold (${config.guardianMaxReviewCycles})`,
    );
  }

  // Gate: database-migration
  if (config.guardianEnableDatabaseMigration && filesChanged.length > 0) {
    const dbMatches = filesChanged.filter((f) => matchesAny(f, DATABASE_MIGRATION_PATTERNS));
    if (dbMatches.length > 0) {
      triggeredGates.push(GUARDIAN_GATE_IDS.DATABASE_MIGRATION);
      reasons.push(`Database migration files detected: ${dbMatches.join(', ')}`);
    }
  }

  // Gate: dependency-change
  if (config.guardianEnableDependencyChange && filesChanged.length > 0) {
    const depMatches = filesChanged.filter((f) => {
      const basename = f.replace(/\\/g, '/').split('/').pop();
      return matchesAny(basename, DEPENDENCY_CHANGE_PATTERNS);
    });
    if (depMatches.length > 0) {
      triggeredGates.push(GUARDIAN_GATE_IDS.DEPENDENCY_CHANGE);
      reasons.push(`Dependency files modified: ${depMatches.join(', ')}`);
    }
  }

  return {
    shouldPause: triggeredGates.length > 0,
    triggeredGates,
    reasons,
  };
}
