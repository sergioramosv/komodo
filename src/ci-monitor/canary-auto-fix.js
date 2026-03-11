import { fixReviewIssues } from '../agents/coder.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT = 'CANARY-AUTO-FIX';
/** Maximum characters of CI error log to pass to the fix agent (not LLM tokens). */
const MAX_LOG_CHARS = 5000;
const MAX_TURNS = 5;

/**
 * Runs a mini auto-fix agent for canary CI failures.
 *
 * Uses fixReviewIssues() with a hard cap of MAX_TURNS (5) and ~5K token budget.
 * The Coder works on the staging branch to fix the failure without touching main.
 *
 * @param {object} options
 * @param {object} options.taskSpec - Original task specification
 * @param {string} options.branchName - Staging branch to fix (not the feature branch)
 * @param {string} options.repo - Repository in owner/repo format
 * @param {string} options.cwd - Working directory
 * @param {string} options.errorLog - CI failure log output
 * @param {string} [options.coderModel] - Model to use for the fix agent
 * @param {string} [options.codingGuidelines] - Coding guidelines to pass to the agent
 * @returns {Promise<{ fixed: boolean, error?: string }>}
 */
export async function runCanaryAutoFix({
  taskSpec,
  branchName,
  repo,
  cwd,
  errorLog,
  coderModel,
  codingGuidelines,
}) {
  logger.info(`Canary auto-fix: attempting to fix CI failure on branch "${branchName}"`, AGENT);

  // Build a minimal task spec targeting the staging branch with the CI error as context
  const fixTaskSpec = {
    ...taskSpec,
    branchName,
    acceptanceCriteria: [
      ...(taskSpec.acceptanceCriteria || []),
      'Fix the CI failure so the pipeline passes on the staging branch',
    ],
    implementationPlan: null, // let the agent reason from error log
    ciErrorLog: errorLog.slice(0, MAX_LOG_CHARS),
  };

  const fixContext = [
    `## Canary CI Failure`,
    `The CI pipeline failed on the staging branch "${branchName}".`,
    `Fix the root cause so CI passes. Error log:`,
    '```',
    errorLog.slice(0, MAX_LOG_CHARS),
    '```',
    '',
    'Constraints:',
    `- Work directly on branch "${branchName}" (already checked out)`,
    `- Maximum ~${MAX_LOG_CHARS} tokens`,
    '- Only fix what is broken — do not add unrelated changes',
  ].join('\n');

  try {
    const result = await fixReviewIssues(
      fixTaskSpec,
      null,
      { issues: [fixContext] },
      cwd,
      { model: coderModel || config.forceModel_CODER || undefined, codingGuidelines, maxTurns: MAX_TURNS },
    );

    if (result && result.success !== false) {
      logger.success(`Canary auto-fix succeeded on branch "${branchName}"`, AGENT);
      return { fixed: true };
    }

    const errMsg = result?.error || 'Auto-fix agent returned no success indicator';
    logger.warn(`Canary auto-fix did not succeed: ${errMsg}`, AGENT);
    return { fixed: false, error: errMsg };
  } catch (err) {
    logger.error(`Canary auto-fix threw an error: ${err.message}`, AGENT);
    return { fixed: false, error: err.message };
  }
}
