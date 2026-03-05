import { execFileSync } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

const AGENT = 'AUTO-REVERT';
const CMD_TIMEOUT = 30_000;

/**
 * Runs a gh CLI command and returns parsed JSON or raw output.
 * Local helper to avoid circular dependency with ci-monitor.js.
 */
function runGh(args, { repo } = {}) {
  const fullArgs = [...args];
  if (repo) {
    fullArgs.push('--repo', repo);
  }

  const output = execFileSync('gh', fullArgs, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: CMD_TIMEOUT,
  }).trim();

  if (!output) return null;

  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

/**
 * Runs a git command and returns stdout.
 */
function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: CMD_TIMEOUT,
  }).trim();
}

/**
 * Creates a revert PR for a merged PR that broke CI, auto-merges it,
 * and returns the task to to-do.
 *
 * Flow: fetch main → create local branch → git revert → push → open PR → auto-merge
 *
 * @param {object} options
 * @param {number} options.prNumber - The original PR that broke CI
 * @param {string} options.repo - Repository in owner/repo format
 * @param {string} options.errorLog - CI failure logs to include in the revert PR body
 * @param {number} options.runId - The failed CI run ID
 * @param {string} [options.mergeCommitSha] - Merge commit SHA (auto-detected if not provided)
 * @returns {{ success: boolean, revertPrNumber?: number, error?: string }}
 */
export function autoRevertPR({ prNumber, repo, errorLog, runId, mergeCommitSha }) {
  if (!config.autoRevert) {
    return { success: false, error: 'AUTO_REVERT disabled' };
  }

  const revertBranch = `revert-pr-${prNumber}`;

  try {
    // Get the merge commit SHA if not provided
    const sha = mergeCommitSha || getMergeCommitSha(repo, prNumber);
    if (!sha) {
      return { success: false, error: `Could not find merge commit for PR #${prNumber}` };
    }

    logger.info(`Creating revert for PR #${prNumber} (merge commit: ${sha})`, AGENT);

    const cwd = config.rootDir;

    // Detect parent count to handle squash vs merge commits
    const parentCount = getCommitParentCount(repo, sha);

    // Create revert branch, revert commit, push
    createBranchAndRevert(cwd, revertBranch, sha, parentCount);

    // Open a revert PR
    const truncatedLog = (errorLog || '').slice(0, 3000);
    const revertPrNumber = openRevertPR(repo, revertBranch, prNumber, truncatedLog, runId);

    // Auto-merge the revert PR (skip review)
    mergeRevertPR(repo, revertPrNumber);

    logger.success(`Revert PR #${revertPrNumber} merged — main restored`, AGENT);

    eventBus.emitEvent(EVENT_TYPES.CI_AUTO_REVERTED, {
      metadata: {
        originalPrNumber: prNumber,
        revertPrNumber,
        repo,
        runId,
      },
    });

    return { success: true, revertPrNumber };
  } catch (err) {
    logger.error(`Auto-revert failed for PR #${prNumber}: ${err.message}`, AGENT);
    // Cleanup: try to delete remote branch if it was created
    try {
      runGit(['push', 'origin', '--delete', revertBranch], config.rootDir);
    } catch { /* best effort cleanup */ }
    return { success: false, error: err.message };
  }
}

/**
 * Gets the merge commit SHA for a PR.
 */
function getMergeCommitSha(repo, prNumber) {
  try {
    const result = runGh([
      'pr', 'view', String(prNumber),
      '--json', 'mergeCommit',
    ], { repo });
    return result?.mergeCommit?.oid || null;
  } catch {
    return null;
  }
}

/**
 * Gets the parent count of a commit (1 = regular/squash, 2+ = merge commit).
 */
function getCommitParentCount(repo, sha) {
  try {
    const result = runGh([
      'api', `repos/${repo}/git/commits/${sha}`,
      '--jq', '.parents | length',
    ]);
    return parseInt(result, 10) || 1;
  } catch {
    return 1;
  }
}

/**
 * Creates a revert branch from origin/main, reverts the merge commit, and pushes.
 */
function createBranchAndRevert(cwd, revertBranch, mergeCommitSha, parentCount) {
  runGit(['fetch', 'origin', 'main'], cwd);
  runGit(['checkout', '-b', revertBranch, 'origin/main'], cwd);

  const revertArgs = ['revert', '--no-edit'];
  if (parentCount >= 2) {
    revertArgs.push('-m', '1');
  }
  revertArgs.push(mergeCommitSha);

  runGit(revertArgs, cwd);
  runGit(['push', 'origin', revertBranch], cwd);

  logger.info(`Revert commit pushed to ${revertBranch}`, AGENT);
}

/**
 * Opens a revert PR with CI failure details.
 *
 * @returns {number} The created PR number
 */
function openRevertPR(repo, revertBranch, originalPrNumber, errorLog, runId) {
  const title = `Revert PR #${originalPrNumber}: CI failure`;
  const body = [
    `## Auto-revert`,
    '',
    `CI failed after merging PR #${originalPrNumber} (run #${runId}).`,
    `This PR reverts the merge commit to restore main to a green state.`,
    '',
    `## CI Error Log`,
    '',
    '```',
    errorLog || '(no logs available)',
    '```',
    '',
    `> Generated automatically by Komodo CI Monitor (AUTO_REVERT=true)`,
  ].join('\n');

  const result = runGh([
    'pr', 'create',
    '--head', revertBranch,
    '--base', 'main',
    '--title', title,
    '--body', body,
  ], { repo });

  const prUrl = typeof result === 'string' ? result : '';
  const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);

  if (!prNumberMatch) {
    throw new Error(`Could not parse PR number from: ${prUrl}`);
  }

  const prNumber = parseInt(prNumberMatch[1], 10);
  logger.info(`Revert PR #${prNumber} created`, AGENT);
  return prNumber;
}

/**
 * Auto-merges the revert PR with admin override (skip required reviews).
 */
function mergeRevertPR(repo, prNumber) {
  runGh([
    'pr', 'merge', String(prNumber),
    '--squash',
    '--delete-branch',
    '--admin',
  ], { repo });

  logger.info(`Revert PR #${prNumber} merged`, AGENT);
}
