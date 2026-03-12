import { logger } from '../../utils/logger.js';
import { flakyTestRegistry } from '../flaky-test-registry.js';

/** Test failure patterns */
const TEST_FAILURE_PATTERNS = [
  /FAIL\s+\S+\.test\./i,
  /Tests failed/i,
  /test.*failed/i,
  /\d+ failed/i,
  /AssertionError/i,
  /expect\(.*\)\.to/i,
  /✕|✗|✘/,
  /FAILED/,
];

/** Patterns that indicate a flaky test (non-deterministic) */
const FLAKY_INDICATORS = [
  /timeout/i,
  /async.*timeout/i,
  /race condition/i,
  /ECONNRESET/,
  /network/i,
];

/** Pattern to extract test names from output */
const TEST_NAME_PATTERN = /●\s+(.+?)\n|FAIL.*›\s+(.+?)(?:\n|$)|✕\s+(.+?)(?:\s+\(\d+ms\))?$/gm;

/**
 * Classify failure type based on error output.
 * @param {string} output
 * @param {string[]} testNames
 * @returns {'flaky'|'new-test-failure'|'regression'}
 */
function classifyFailure(output, testNames) {
  // Known flaky test?
  if (testNames.some(name => flakyTestRegistry.isKnownFlaky(name))) {
    return 'flaky';
  }
  // Flaky indicators in output?
  if (FLAKY_INDICATORS.some(p => p.test(output))) {
    return 'flaky';
  }
  return 'new-test-failure';
}

/**
 * Extract failing test names from test runner output.
 * @param {string} output
 * @returns {string[]}
 */
function extractTestNames(output) {
  const names = [];
  let match;
  const re = new RegExp(TEST_NAME_PATTERN.source, TEST_NAME_PATTERN.flags);
  while ((match = re.exec(output)) !== null) {
    const name = match[1] || match[2] || match[3];
    if (name) names.push(name.trim());
  }
  return [...new Set(names)];
}

/**
 * Self-healing strategy for test failures.
 *
 * Classifies between:
 * - flaky: retry without LLM
 * - new-test-failure: fix code with LLM
 * - regression: fix with historical context
 */
export const testFailureStrategy = {
  name: 'test-failure',

  /**
   * @param {{ errorMessage: string }} errorContext
   * @returns {boolean}
   */
  detect(errorContext) {
    const { errorMessage } = errorContext;
    if (!errorMessage) return false;
    return TEST_FAILURE_PATTERNS.some(p => p.test(errorMessage));
  },

  /**
   * @param {{ errorMessage: string, priorOutput?: string }} errorContext
   * @returns {{ failureType: 'flaky'|'new-test-failure'|'regression', testNames: string[] }}
   */
  diagnose(errorContext) {
    const { errorMessage = '', priorOutput = '' } = errorContext;
    const combined = `${priorOutput}\n${errorMessage}`;
    const testNames = extractTestNames(combined);
    const failureType = classifyFailure(combined, testNames);
    return { failureType, testNames };
  },

  /**
   * @param {{ errorMessage: string, priorOutput?: string, runTests?: () => Promise<{passed: boolean, output: string}>, fixCode?: (context: object) => Promise<{success: boolean}> }} errorContext
   * @returns {Promise<{ healed: boolean, action: string }>}
   */
  async heal(errorContext) {
    const { errorMessage, priorOutput, runTests, fixCode } = errorContext;
    const { failureType, testNames } = this.diagnose({ errorMessage, priorOutput });

    logger.info(`Self-healing test failure: type=${failureType}, tests=[${testNames.slice(0, 3).join(', ')}]`, 'SELF-HEALING');

    if (failureType === 'flaky') {
      // Register tests as potentially flaky
      testNames.forEach(name => flakyTestRegistry.register(name));

      // Retry without LLM
      if (typeof runTests === 'function') {
        const retryResult = await runTests();
        testNames.forEach(name => flakyTestRegistry.recordRetryResult(name, retryResult.passed));
        if (retryResult.passed) {
          return { healed: true, action: 'flaky-retry-passed' };
        }
      }
      return { healed: false, action: 'flaky-retry-failed' };
    }

    // new-test-failure or regression: fix with LLM
    if (typeof fixCode === 'function') {
      const fixResult = await fixCode({
        failureType,
        testNames,
        output: errorMessage,
        includeHistory: failureType === 'regression',
      });
      return { healed: fixResult.success, action: `fix-${failureType}` };
    }

    return { healed: false, action: 'no-fix-available' };
  },
};
