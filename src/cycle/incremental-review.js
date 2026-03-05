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
 * @param {string} options.cwd - Working directory
 * @param {number} options.cycle - Current cycle number
 * @param {string} [options.lastReviewSHA] - Commit SHA at the time of the last review
 * @returns {Promise<{
 *   incrementalDiff: string,
 *   previousIssuesSummary: string,
 *   newFiles: string[],
 *   incrementalDiffTokenEstimate: number,
 * }>}
 */
export async function buildIncrementalContext({ previousReview, cwd, cycle, lastReviewSHA }) {
  const previousIssuesSummary = formatPreviousIssues(previousReview);

  // Get the fix commit(s) diff — all commits since last review
  const { diff: incrementalDiff, newFiles } = await getFixCommitDiff(cwd, lastReviewSHA);

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
 * Gets the diff of fix commit(s) since the last review.
 * Uses `git diff <lastReviewSHA>..HEAD` to capture all fix commits.
 *
 * @param {string} cwd - Working directory
 * @param {string} [lastReviewSHA] - Commit SHA at the time of the last review
 * @returns {Promise<{ diff: string, newFiles: string[] }>}
 */
async function getFixCommitDiff(cwd, lastReviewSHA) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const execOpts = { cwd, maxBuffer: 10 * 1024 * 1024 };
  const diffRange = lastReviewSHA ? `${lastReviewSHA}..HEAD` : 'HEAD~1..HEAD';

  try {
    // Get the diff of all fix commits since last review
    const { stdout: diff } = await execFileAsync(
      'git', ['diff', diffRange], execOpts,
    );

    // Detect new files added in the fix commits
    const { stdout: statusOutput } = await execFileAsync(
      'git', ['diff', '--name-status', diffRange], execOpts,
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
3. If a previous issue was NOT fixed, report it again with a note that it persists

### Fix Commit Diff
\`\`\`diff
${context.incrementalDiff}
\`\`\``;

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
 * @param {number} fullDiffTokens - Token estimate for the full PR diff (actual)
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
 * Gets the current HEAD commit SHA.
 *
 * @param {string} cwd - Working directory
 * @returns {Promise<string>} The HEAD commit SHA
 */
export async function getHeadSHA(cwd) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

/**
 * Gets the full PR diff token estimate by running git diff against the base branch.
 *
 * @param {string} cwd - Working directory
 * @param {string} baseBranch - Base branch (e.g. 'main')
 * @returns {Promise<number>} Estimated tokens for the full diff
 */
export async function getFullDiffTokenEstimate(cwd, baseBranch = 'main') {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout: diff } = await execFileAsync(
      'git', ['diff', `${baseBranch}...HEAD`],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
    );
    return estimateTokens(diff);
  } catch {
    return 0;
  }
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
