import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT_TAG = 'INCREMENTAL-REVIEW';

/**
 * Determines if incremental review should be used for this cycle.
 *
 * @param {number} cycle - Current review cycle (1-based)
 * @returns {boolean} True if incremental review should be used
 */
export function shouldUseIncrementalReview(cycle) {
  return config.incrementalReview && cycle > 1;
}

/**
 * Builds the incremental review context for fix cycles.
 * Instead of reviewing the full PR diff, the Reviewer gets:
 * - Diff of only the fix commit(s) since last review
 * - Summary of previous issues and what was supposed to be fixed
 * - List of new files (if any) that need full review
 *
 * @param {Object} options
 * @param {Object} options.previousReview - The previous review result
 * @param {string} options.branchName - Branch name for the PR
 * @param {string} options.cwd - Working directory
 * @param {number} options.cycle - Current cycle number
 * @returns {Promise<{
 *   incrementalDiff: string,
 *   previousIssuesSummary: string,
 *   newFiles: string[],
 *   fullDiffTokenEstimate: number,
 *   incrementalDiffTokenEstimate: number,
 * }>}
 */
export async function buildIncrementalContext({ previousReview, branchName, cwd, cycle }) {
  const previousIssuesSummary = formatPreviousIssues(previousReview);

  // Get the last fix commit(s) diff — commits since last review
  const { diff: incrementalDiff, newFiles } = await getFixCommitDiff(cwd);

  // Estimate tokens (rough: ~4 chars per token)
  const incrementalDiffTokenEstimate = estimateTokens(incrementalDiff);

  logger.info(
    `Incremental review cycle ${cycle}: ~${incrementalDiffTokenEstimate} tokens (diff only fix commits)`,
    AGENT_TAG,
  );

  if (newFiles.length > 0) {
    logger.info(`New files detected in fix: ${newFiles.join(', ')}`, AGENT_TAG);
  }

  return {
    incrementalDiff,
    previousIssuesSummary,
    newFiles,
    incrementalDiffTokenEstimate,
  };
}

/**
 * Gets the diff of only the last fix commit(s).
 * Uses `git diff HEAD~1..HEAD` to get changes from the most recent commit.
 * If multiple fix commits were made, it detects all fix commits since the last review.
 *
 * @param {string} cwd - Working directory
 * @returns {Promise<{ diff: string, newFiles: string[] }>}
 */
async function getFixCommitDiff(cwd) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const execOpts = { cwd, maxBuffer: 10 * 1024 * 1024 };

  try {
    // Get the diff of the last commit (fix commit)
    const { stdout: diff } = await execFileAsync(
      'git', ['diff', 'HEAD~1..HEAD'], execOpts,
    );

    // Detect new files added in the fix commit
    const { stdout: statusOutput } = await execFileAsync(
      'git', ['diff', '--name-status', 'HEAD~1..HEAD'], execOpts,
    );

    const newFiles = statusOutput
      .split('\n')
      .filter(line => line.startsWith('A\t'))
      .map(line => line.substring(2).trim())
      .filter(Boolean);

    return { diff: diff || '(no changes)', newFiles };
  } catch (err) {
    logger.warn(`Could not get fix commit diff: ${err.message}`, AGENT_TAG);
    return { diff: '(could not retrieve incremental diff)', newFiles: [] };
  }
}

/**
 * Formats previous review issues into a summary for the incremental reviewer.
 *
 * @param {Object} previousReview - Previous review result
 * @returns {string} Formatted summary
 */
export function formatPreviousIssues(previousReview) {
  if (!previousReview || !previousReview.issues || previousReview.issues.length === 0) {
    return 'No previous issues recorded.';
  }

  const lines = previousReview.issues.map((issue, i) => {
    if (typeof issue === 'string') {
      return `${i + 1}. ${issue}`;
    }
    const severity = issue.severity ? `[${issue.severity.toUpperCase()}]` : '';
    const file = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : '';
    const suggestion = issue.suggestion ? ` — Fix: ${issue.suggestion}` : '';
    return `${i + 1}. ${severity} ${issue.description || JSON.stringify(issue)}${file}${suggestion}`;
  });

  return `Previous review found ${previousReview.issues.length} issue(s) (score: ${previousReview.score || 'N/A'}/10):\n${lines.join('\n')}`;
}

/**
 * Builds the incremental review prompt section to inject into the reviewer's user prompt.
 *
 * @param {Object} context - Output from buildIncrementalContext
 * @returns {string} Prompt section for incremental review
 */
export function buildIncrementalPromptSection(context) {
  let section = `
## INCREMENTAL REVIEW MODE (Fix Cycle)

This is a fix cycle review. You ONLY need to review the changes made to fix previous issues.
Do NOT re-review the entire PR — focus exclusively on the fix commit diff below.

### Previous Issues to Verify
${context.previousIssuesSummary}

### Your Task
1. For EACH previous issue listed above, verify if it was properly fixed
2. Check that the fix doesn't introduce NEW issues
3. If a previous issue was NOT fixed, report it again with a note that it persists`;

  if (context.newFiles.length > 0) {
    section += `

### New Files Added in Fix
The following files are NEW (not seen in previous review). Review them fully:
${context.newFiles.map(f => `- ${f}`).join('\n')}`;
  }

  return section;
}

/**
 * Calculates metrics comparing incremental vs full review.
 *
 * @param {number} fullDiffTokens - Token estimate for the full PR diff
 * @param {number} incrementalDiffTokens - Token estimate for the incremental diff
 * @returns {{ tokensSaved: number, percentageSaved: number }}
 */
export function calculateSavings(fullDiffTokens, incrementalDiffTokens) {
  const tokensSaved = Math.max(0, fullDiffTokens - incrementalDiffTokens);
  const percentageSaved = fullDiffTokens > 0
    ? Math.round((tokensSaved / fullDiffTokens) * 100)
    : 0;

  return { tokensSaved, percentageSaved };
}

/**
 * Estimates token count from a string (rough estimate: ~4 chars per token).
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
