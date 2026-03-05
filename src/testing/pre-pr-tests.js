import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

const AGENT = 'TESTS';
const MAX_FIX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT = 300_000; // 5 min

/**
 * Auto-detect the test command for a project by inspecting common config files.
 *
 * @param {string} cwd - Project directory
 * @returns {string|null} Detected test command or null
 */
export function detectTestCommand(cwd) {
  // 1. package.json scripts.test
  const pkgPath = resolve(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return 'npm test';
      }
    } catch { /* ignore parse errors */ }
  }

  // 2. pytest (Python)
  const pytestFiles = ['pytest.ini', 'pyproject.toml', 'setup.cfg'];
  for (const f of pytestFiles) {
    if (existsSync(resolve(cwd, f))) {
      return 'pytest';
    }
  }

  // 3. Go
  if (existsSync(resolve(cwd, 'go.mod'))) {
    return 'go test ./...';
  }

  // 4. Cargo (Rust)
  if (existsSync(resolve(cwd, 'Cargo.toml'))) {
    return 'cargo test';
  }

  return null;
}

/**
 * Resolve the effective test command: explicit config > auto-detect > null.
 *
 * @param {string} cwd - Project directory
 * @returns {string|null}
 */
export function resolveTestCommand(cwd) {
  const cmd = config.prePrTestCmd;

  if (cmd && cmd !== 'auto') {
    return cmd;
  }

  return detectTestCommand(cwd);
}

/**
 * Execute a test command and capture the result.
 *
 * @param {string} command - Shell command to run (e.g. "npm test")
 * @param {string} cwd - Working directory
 * @returns {{ passed: boolean, output: string, exitCode: number }}
 */
export function runTests(command, cwd) {
  const [cmd, ...args] = command.split(' ');
  const isWindows = process.platform === 'win32';

  try {
    const output = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf-8',
      timeout: DEFAULT_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows,
    });

    return { passed: true, output, exitCode: 0 };
  } catch (err) {
    const output = (err.stdout || '') + '\n' + (err.stderr || '');
    return { passed: false, output: output.trim(), exitCode: err.status || 1 };
  }
}

/**
 * Parse test output for a human-readable summary line.
 * Attempts to extract "X passed, Y failed" from common test runner formats.
 *
 * @param {string} output - Raw test output
 * @returns {string} Summary line
 */
export function parseTestSummary(output) {
  // Vitest/Jest: "Tests  42 passed"
  const vitestMatch = output.match(/Tests?\s+(\d+)\s+passed(?:.*?(\d+)\s+failed)?/i);
  if (vitestMatch) {
    const passed = vitestMatch[1];
    const failed = vitestMatch[2] || '0';
    return `${passed} passed, ${failed} failed`;
  }

  // pytest: "42 passed, 2 failed"
  const pytestMatch = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/);
  if (pytestMatch) {
    const passed = pytestMatch[1];
    const failed = pytestMatch[2] || '0';
    return `${passed} passed, ${failed} failed`;
  }

  // Go: "ok" or "FAIL"
  const goPassMatch = output.match(/^ok\s/m);
  if (goPassMatch) return 'all tests passed';

  const goFailMatch = output.match(/^FAIL\s/m);
  if (goFailMatch) return 'tests failed';

  return 'test execution completed';
}

/**
 * Run pre-PR tests with auto-fix retry loop.
 *
 * @param {Object} options
 * @param {string} options.cwd - Repository working directory
 * @param {Function} [options.onFixAttempt] - Called when a fix attempt is needed.
 *   Receives (failureOutput, attempt) and should return { fixed: boolean }.
 *   If not provided, no auto-fix is attempted.
 * @returns {Promise<PrePRTestReport>}
 *
 * @typedef {Object} PrePRTestReport
 * @property {boolean} success - true if tests passed (or feature is disabled)
 * @property {boolean} skipped - true if feature is disabled or no test command found
 * @property {string} [reason] - Reason if skipped
 * @property {boolean} passed - true if all tests passed
 * @property {string} summary - Human-readable summary
 * @property {string} output - Raw test output (last run)
 * @property {number} attempts - Number of test runs performed
 * @property {boolean} needsManualReview - true if tests still fail after max attempts
 */
export async function executePrePRTests({ cwd, onFixAttempt } = {}) {
  // Check if feature is enabled
  if (!config.prePrTests) {
    return emptyReport('PRE_PR_TESTS disabled');
  }

  if (!cwd) {
    return emptyReport('No working directory provided');
  }

  // Resolve test command
  const testCommand = resolveTestCommand(cwd);
  if (!testCommand) {
    return emptyReport('No test command detected');
  }

  logger.info(`Running pre-PR tests: ${testCommand}`, AGENT);

  eventBus.emitEvent(EVENT_TYPES.PRE_PR_TESTS_START, {
    metadata: { testCommand, cwd },
  });

  let lastResult = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    attempts = attempt;
    lastResult = runTests(testCommand, cwd);
    const summary = parseTestSummary(lastResult.output);

    if (lastResult.passed) {
      logger.success(`Running pre-PR tests... ${summary}`, AGENT);

      const report = {
        success: true,
        skipped: false,
        passed: true,
        summary,
        output: lastResult.output,
        attempts,
        needsManualReview: false,
      };

      eventBus.emitEvent(EVENT_TYPES.PRE_PR_TESTS_PASSED, {
        metadata: { summary, attempts },
      });

      return report;
    }

    // Tests failed
    logger.warn(`Test attempt ${attempt}/${MAX_FIX_ATTEMPTS} failed: ${summary}`, AGENT);

    // Try auto-fix if handler provided and not last attempt
    if (onFixAttempt && attempt < MAX_FIX_ATTEMPTS) {
      logger.info(`Attempting auto-fix (${attempt}/${MAX_FIX_ATTEMPTS - 1})...`, AGENT);
      try {
        const fixResult = await onFixAttempt(lastResult.output, attempt);
        if (!fixResult?.fixed) {
          logger.warn('Auto-fix did not resolve the issues', AGENT);
        }
      } catch (err) {
        logger.warn(`Auto-fix error: ${err.message}`, AGENT);
      }
    } else if (attempt >= MAX_FIX_ATTEMPTS) {
      break;
    }
  }

  // All attempts exhausted — tests still failing
  const summary = parseTestSummary(lastResult.output);
  logger.warn(`Tests still failing after ${attempts} attempts. Will open PR with warning.`, AGENT);

  const report = {
    success: false,
    skipped: false,
    passed: false,
    summary,
    output: lastResult.output,
    attempts,
    needsManualReview: true,
  };

  eventBus.emitEvent(EVENT_TYPES.PRE_PR_TESTS_FAILED, {
    metadata: { summary, attempts, needsManualReview: true },
  });

  return report;
}

/**
 * Empty report for when the feature is disabled or skipped.
 */
function emptyReport(reason) {
  return {
    success: true,
    skipped: true,
    reason,
    passed: false,
    summary: reason,
    output: '',
    attempts: 0,
    needsManualReview: false,
  };
}
