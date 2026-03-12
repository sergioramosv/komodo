/**
 * Adaptive Review Depth — selects review depth based on task complexity and security findings.
 *
 * Depths:
 *   quick    — Haiku, 3K max tokens, 2 criteria (trivial tasks)
 *   standard — Sonnet, 10K max tokens, 5 criteria (default)
 *   deep     — Sonnet, 20K max tokens, 8 criteria (auth/payment/crypto files)
 *   forensic — Opus, 40K max tokens, all criteria + line-by-line (critical security findings)
 */

/**
 * Configuration for each review depth level.
 *
 * @type {Record<string, { model: string, estimatedMaxTokens: number, maxTurns: number, criteria: string[] }>}
 */
export const REVIEW_DEPTHS = {
  quick: {
    model: 'claude-haiku-4-5-20251001',
    estimatedMaxTokens: 3_000,
    maxTurns: 10,
    criteria: ['correctitud', 'seguridad-critica'],
  },
  standard: {
    model: 'claude-sonnet-4-6',
    estimatedMaxTokens: 10_000,
    maxTurns: 18,
    criteria: ['correctitud', 'error-handling', 'edge-cases', 'naming', 'estructura'],
  },
  deep: {
    model: 'claude-sonnet-4-6',
    estimatedMaxTokens: 20_000,
    maxTurns: 16,
    criteria: ['correctitud', 'error-handling', 'edge-cases', 'naming', 'estructura', 'tests', 'seguridad', 'patrones'],
  },
  forensic: {
    model: 'claude-opus-4-6',
    estimatedMaxTokens: 40_000,
    maxTurns: 24,
    criteria: ['correctitud', 'error-handling', 'edge-cases', 'naming', 'estructura', 'tests', 'seguridad', 'patrones', 'line-by-line'],
  },
};

/**
 * Files that trigger a deep review when changed.
 */
const SENSITIVE_FILE_PATTERNS = [
  /auth/i,
  /payment/i,
  /billing/i,
  /crypto/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /wallet/i,
  /checkout/i,
  /invoice/i,
];

/**
 * Returns true if a file path matches any sensitive pattern.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isSensitiveFile(filePath) {
  if (typeof filePath !== 'string') return false;
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Selects the appropriate review depth based on task complexity and context.
 *
 * Rules (evaluated in priority order):
 *   1. forensic  — if sonarReport has BLOCKER/CRITICAL security vulnerabilities
 *   2. deep      — if any changed file touches auth/payment/crypto paths
 *   3. quick     — if devPoints <= 2 AND filesChanged <= 3
 *   4. standard  — default
 *
 * @param {Object} options
 * @param {number} [options.devPoints] - Complexity points from task spec
 * @param {string[]} [options.filesChanged] - List of file paths changed by Coder
 * @param {Object} [options.sonarReport] - SonarQube report (optional)
 * @returns {{ depth: string, model: string, estimatedMaxTokens: number, maxTurns: number, criteria: string[] }}
 */
export function selectReviewDepth({ devPoints = 5, filesChanged = [], sonarReport = null } = {}) {
  // Rule 1: forensic if critical security findings
  if (sonarReport?.success) {
    const hasCriticalSecurity =
      (sonarReport.issues?.BLOCKER > 0) ||
      (sonarReport.issueDetails || []).some(
        i => (i.severity === 'BLOCKER' || i.severity === 'CRITICAL') && i.type === 'VULNERABILITY',
      );

    if (hasCriticalSecurity) {
      return { depth: 'forensic', ...REVIEW_DEPTHS.forensic };
    }
  }

  // Rule 2: deep if any sensitive file changed
  if (filesChanged.some(isSensitiveFile)) {
    return { depth: 'deep', ...REVIEW_DEPTHS.deep };
  }

  // Rule 3: quick for trivial tasks
  if (devPoints <= 2 && filesChanged.length <= 3) {
    return { depth: 'quick', ...REVIEW_DEPTHS.quick };
  }

  // Rule 4: standard (default)
  return { depth: 'standard', ...REVIEW_DEPTHS.standard };
}
