import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getDb } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT = 'COVERAGE';
const DEFAULT_TIMEOUT = 300_000; // 5 min
const BASELINE_PATH = '.komodo/coverage-baseline.json';

/**
 * Auto-detect coverage command for a project.
 *
 * @param {string} cwd - Project directory
 * @returns {string|null}
 */
export function detectCoverageCommand(cwd) {
  const pkgPath = resolve(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      // Check for explicit coverage script
      if (pkg.scripts?.['test:coverage']) {
        return 'npm run test:coverage';
      }

      // Check for vitest
      if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) {
        return 'npx vitest run --coverage';
      }

      // Check for jest
      if (pkg.devDependencies?.jest || pkg.dependencies?.jest) {
        return 'npx jest --coverage';
      }

      // Check for c8/nyc
      if (pkg.devDependencies?.c8 || pkg.devDependencies?.nyc) {
        return 'npm test -- --coverage';
      }
    } catch { /* ignore parse errors */ }
  }

  return null;
}

/**
 * Resolve the effective coverage command: explicit config > auto-detect > null.
 *
 * @param {string} cwd - Project directory
 * @returns {string|null}
 */
export function resolveCoverageCommand(cwd) {
  const cmd = config.coverageCmd;

  if (cmd && cmd !== 'auto') {
    return cmd;
  }

  return detectCoverageCommand(cwd);
}

/**
 * Run coverage command and parse the total coverage percentage from output.
 * Supports vitest, jest, c8, and nyc output formats.
 *
 * @param {string} command - Shell command to run
 * @param {string} cwd - Working directory
 * @returns {{ success: boolean, coverage: number|null, output: string }}
 */
export function runCoverage(command, cwd) {
  const [cmd, ...args] = command.split(' ');
  const isWindows = process.platform === 'win32';

  let output;
  try {
    output = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf-8',
      timeout: DEFAULT_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows,
    });
  } catch (err) {
    // Coverage tools may exit non-zero when tests fail but still produce output
    output = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  const coverage = parseCoverageFromOutput(output);

  if (coverage === null) {
    return { success: false, coverage: null, output };
  }

  return { success: true, coverage, output };
}

/**
 * Parse total coverage percentage from test runner output.
 *
 * Supports:
 * - vitest/istanbul: "All files  |  80.5  |  75.2  |  90.1  |  80.5"
 * - jest: "All files  |  80.5  |  75.2  |  90.1  |  80.5"
 * - c8/nyc summary: "Statements   : 80.5%"
 * - Simple percentage: "Coverage: 80.5%"
 *
 * @param {string} output
 * @returns {number|null}
 */
export function parseCoverageFromOutput(output) {
  if (!output) return null;

  // istanbul/vitest/jest table: "All files" row, 4th number is Statements coverage
  // Format: "All files  |  80.5  |  75.2  |  90.1  |  80.5"
  const allFilesMatch = output.match(/All files[^|]*\|\s*([\d.]+)/);
  if (allFilesMatch) {
    return parseFloat(allFilesMatch[1]);
  }

  // c8/nyc summary: "Statements   : 80.5% ( 100/124 )"
  const statementsMatch = output.match(/Statements\s*:\s*([\d.]+)%/i);
  if (statementsMatch) {
    return parseFloat(statementsMatch[1]);
  }

  // Generic: "Coverage: 80.5%" or "Total coverage: 80.5%"
  const genericMatch = output.match(/(?:total\s+)?coverage[:\s]+([\d.]+)%/i);
  if (genericMatch) {
    return parseFloat(genericMatch[1]);
  }

  return null;
}

/**
 * Read the coverage baseline for a project.
 *
 * @param {string} cwd - Project directory
 * @returns {{ coverage: number, timestamp: string, commitSha: string } | null}
 */
export function readBaseline(cwd) {
  const baselinePath = resolve(cwd, BASELINE_PATH);
  if (!existsSync(baselinePath)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(baselinePath, 'utf-8'));
    if (typeof data.coverage === 'number') {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write/update the coverage baseline for a project.
 *
 * @param {string} cwd - Project directory
 * @param {number} coverage - Coverage percentage
 * @param {string} [commitSha] - Commit SHA
 */
export function writeBaseline(cwd, coverage, commitSha = '') {
  const baselinePath = resolve(cwd, BASELINE_PATH);
  const dir = resolve(cwd, '.komodo');

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const data = {
    coverage,
    timestamp: new Date().toISOString(),
    commitSha,
  };

  writeFileSync(baselinePath, JSON.stringify(data, null, 2), 'utf-8');
  logger.info(`Coverage baseline updated: ${coverage}%`, AGENT);
}

/**
 * Run coverage analysis: execute coverage, compare with baseline, produce report.
 *
 * @param {Object} options
 * @param {string} options.cwd - Project directory
 * @returns {CoverageReport}
 *
 * @typedef {Object} CoverageReport
 * @property {boolean} success - true if coverage ran successfully
 * @property {boolean} skipped - true if feature is disabled or no command found
 * @property {string} [reason] - Reason if skipped
 * @property {number|null} coverage - Current coverage percentage
 * @property {number|null} baselineCoverage - Baseline coverage percentage
 * @property {number|null} delta - Coverage delta (current - baseline)
 * @property {boolean} belowThreshold - true if delta < minCoverageDelta
 * @property {string} summary - Human-readable summary
 */
export function analyzeCoverage({ cwd } = {}) {
  if (!config.coverageCheck) {
    return emptyReport('COVERAGE_CHECK disabled');
  }

  if (!cwd) {
    return emptyReport('No working directory provided');
  }

  const coverageCmd = resolveCoverageCommand(cwd);
  if (!coverageCmd) {
    return emptyReport('No coverage command detected');
  }

  logger.info(`Running coverage: ${coverageCmd}`, AGENT);

  eventBus.emitEvent(EVENT_TYPES.COVERAGE_CHECK_START, {
    metadata: { coverageCmd, cwd },
  });

  const result = runCoverage(coverageCmd, cwd);

  if (!result.success) {
    logger.warn('Could not parse coverage from output', AGENT);

    eventBus.emitEvent(EVENT_TYPES.COVERAGE_CHECK_ERROR, {
      metadata: { error: 'Could not parse coverage from output' },
    });

    return {
      success: false,
      skipped: false,
      coverage: null,
      baselineCoverage: null,
      delta: null,
      belowThreshold: false,
      summary: 'Coverage command ran but could not parse percentage',
    };
  }

  const currentCoverage = result.coverage;
  const baseline = readBaseline(cwd);
  const baselineCoverage = baseline?.coverage ?? null;

  let delta = null;
  let belowThreshold = false;
  let summary = '';

  if (baselineCoverage !== null) {
    delta = parseFloat((currentCoverage - baselineCoverage).toFixed(2));
    belowThreshold = delta < config.minCoverageDelta;

    const sign = delta >= 0 ? '+' : '';
    summary = `Coverage: ${currentCoverage}% (${sign}${delta}% vs baseline ${baselineCoverage}%)`;

    if (belowThreshold) {
      logger.warn(`${summary} — BELOW THRESHOLD (min: ${config.minCoverageDelta}%)`, AGENT);
    } else if (delta > 0) {
      logger.success(summary, AGENT);
    } else {
      logger.info(summary, AGENT);
    }
  } else {
    summary = `Coverage: ${currentCoverage}% (no baseline — first run)`;
    logger.info(summary, AGENT);
  }

  const report = {
    success: true,
    skipped: false,
    coverage: currentCoverage,
    baselineCoverage,
    delta,
    belowThreshold,
    summary,
  };

  eventBus.emitEvent(EVENT_TYPES.COVERAGE_CHECK_COMPLETE, {
    metadata: {
      coverage: currentCoverage,
      baselineCoverage,
      delta,
      belowThreshold,
    },
  });

  return report;
}

/**
 * Update coverage baseline after a successful merge.
 *
 * @param {Object} options
 * @param {string} options.cwd - Project directory
 * @param {string} [options.commitSha] - Merge commit SHA
 */
export function updateBaselineAfterMerge({ cwd, commitSha } = {}) {
  if (!config.coverageCheck || !cwd) return;

  const coverageCmd = resolveCoverageCommand(cwd);
  if (!coverageCmd) return;

  logger.info('Updating coverage baseline after merge...', AGENT);

  const result = runCoverage(coverageCmd, cwd);
  if (!result.success) {
    logger.warn('Could not update coverage baseline: parse failure', AGENT);
    return;
  }

  writeBaseline(cwd, result.coverage, commitSha || '');

  eventBus.emitEvent(EVENT_TYPES.COVERAGE_BASELINE_UPDATED, {
    metadata: { coverage: result.coverage, commitSha },
  });
}

/**
 * Record a coverage data point in Firebase for trend tracking.
 *
 * @param {Object} options
 * @param {string} options.projectId - Project ID
 * @param {number} options.coverage - Coverage percentage
 * @param {number|null} options.delta - Coverage delta vs baseline
 * @param {string} [options.commitSha] - Commit SHA
 * @param {string} [options.prNumber] - PR number
 */
export async function recordCoverageHistory({ projectId, coverage, delta, commitSha, prNumber } = {}) {
  if (!projectId || typeof coverage !== 'number') return;

  try {
    const db = getDb();
    const entry = {
      coverage,
      delta: delta ?? null,
      commitSha: commitSha || '',
      prNumber: prNumber || '',
      timestamp: new Date().toISOString(),
    };

    await db.ref(`metrics/${projectId}/coverageHistory`).push(entry);
    logger.info(`Coverage history recorded: ${coverage}%`, AGENT);
  } catch (err) {
    logger.warn(`Failed to record coverage history: ${err.message}`, AGENT);
  }
}

/**
 * Build a coverage section for the reviewer prompt.
 *
 * @param {CoverageReport} report
 * @returns {string}
 */
export function buildCoverageSection(report) {
  if (!report || report.skipped || !report.success) return '';

  const { coverage, baselineCoverage, delta, belowThreshold } = report;

  let section = `
## Coverage Delta Analysis

- **Current coverage**: ${coverage}%`;

  if (baselineCoverage !== null) {
    const sign = delta >= 0 ? '+' : '';
    section += `
- **Baseline coverage (main)**: ${baselineCoverage}%
- **Delta**: ${sign}${delta}%
- **Threshold**: ${config.minCoverageDelta}%`;

    if (belowThreshold) {
      section += `
- **STATUS: COVERAGE DROP DETECTED** — Coverage dropped by ${Math.abs(delta)}%, which exceeds the allowed threshold of ${config.minCoverageDelta}%.

### Instructions for Reviewer
- This coverage drop MUST be reported as a **major** issue in your review.
- The Coder should add tests to cover the new code before this PR can be approved.
- If the coverage drop is justified (e.g., removing dead code), mention it but still flag it.`;
    } else if (delta > 0) {
      section += `
- **STATUS: COVERAGE IMPROVED**

### Instructions for Reviewer
- Mention the coverage improvement as a **positive** point in your review.`;
    } else {
      section += `
- **STATUS: COVERAGE STABLE**`;
    }
  } else {
    section += `
- **Baseline**: Not available (first coverage run for this project)

### Instructions for Reviewer
- Note that no coverage baseline exists yet. This coverage value will become the baseline after merge.`;
  }

  return section;
}

function emptyReport(reason) {
  return {
    success: true,
    skipped: true,
    reason,
    coverage: null,
    baselineCoverage: null,
    delta: null,
    belowThreshold: false,
    summary: reason,
  };
}
