import { execFileSync } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { create, update } from '../../skills/planning-task-mcp/src/firebase.js';
import { autoRevertPR } from './auto-revert.js';

const AGENT = 'CI-MONITOR';
const POLL_INTERVAL_MS = 15_000; // 15s between polls
const GH_TIMEOUT = 30_000;

/**
 * Runs a gh CLI command and returns the parsed JSON output.
 *
 * @param {string[]} args - Arguments for gh
 * @param {object} [options]
 * @param {string} [options.repo] - Repository in owner/repo format
 * @returns {object|string|null} Parsed JSON or raw output
 */
export function runGhCommand(args, { repo } = {}) {
  const fullArgs = [...args];
  if (repo) {
    fullArgs.push('--repo', repo);
  }

  try {
    const output = execFileSync('gh', fullArgs, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: GH_TIMEOUT,
    }).trim();

    if (!output) return null;

    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || '';
    throw new Error(`gh ${fullArgs.join(' ')} failed: ${stderr || err.message}`);
  }
}

/**
 * Lists the most recent workflow runs on a branch.
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {string} branch - Branch to check (e.g., "main")
 * @param {number} [limit=5] - Maximum runs to return
 * @returns {Array<{ databaseId: number, status: string, conclusion: string, headSha: string, name: string }>}
 */
export function listRuns(repo, branch, limit = 5) {
  const result = runGhCommand([
    'run', 'list',
    '--branch', branch,
    '--limit', String(limit),
    '--json', 'databaseId,status,conclusion,headSha,name',
  ], { repo });

  return Array.isArray(result) ? result : [];
}

/**
 * Gets the failed logs from a specific run.
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {number} runId - The workflow run ID
 * @returns {string} Failed log output (truncated to 5000 chars)
 */
export function getFailedLogs(repo, runId) {
  try {
    const output = execFileSync('gh', [
      'run', 'view', String(runId),
      '--repo', repo,
      '--log-failed',
    ], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: GH_TIMEOUT,
    }).trim();

    return output.slice(0, 5000);
  } catch (err) {
    logger.warn(`Could not fetch failed logs for run ${runId}: ${err.message}`, AGENT);
    return `(could not fetch logs: ${err.message})`;
  }
}

/**
 * Finds the latest run that matches a given merge commit SHA.
 *
 * @param {Array} runs - List of workflow runs
 * @param {string} mergeCommitSha - SHA to match
 * @returns {object|null} Matching run or null
 */
export function findRunForCommit(runs, mergeCommitSha) {
  if (!mergeCommitSha || !Array.isArray(runs)) return null;
  return runs.find(r => r.headSha === mergeCommitSha) || null;
}

/**
 * Gets the merge commit SHA for a PR.
 *
 * @param {string} repo - Repository in owner/repo format
 * @param {number} prNumber - PR number
 * @returns {string|null} Merge commit SHA or null
 */
export function getMergeCommitSha(repo, prNumber) {
  try {
    const result = runGhCommand([
      'pr', 'view', String(prNumber),
      '--json', 'mergeCommit',
    ], { repo });

    return result?.mergeCommit?.oid || null;
  } catch (err) {
    logger.warn(`Could not get merge commit for PR #${prNumber}: ${err.message}`, AGENT);
    return null;
  }
}

/**
 * Waits for a promise to resolve with a delay.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a bug task in the backlog for a failed CI run.
 *
 * @param {object} options
 * @param {number} options.prNumber
 * @param {number} options.runId
 * @param {string} options.errorLog
 * @param {string} options.projectId
 * @param {string} options.repo
 * @returns {Promise<string|null>} Created task ID or null on failure
 */
export async function createCiBugTask({ prNumber, runId, errorLog, projectId, repo }) {
  const title = `[CI Bug] Pipeline failed after merging PR #${prNumber}`;

  const taskData = {
    projectId,
    title,
    userStory: {
      who: 'the development team',
      what: `fix the CI pipeline failure caused by PR #${prNumber} merge`,
      why: 'the main branch CI is broken and blocking further development',
    },
    acceptanceCriteria: [
      'Identify the root cause of the CI failure',
      'Fix the failing tests or build issues',
      'Verify CI passes on main after the fix',
    ],
    bizPoints: 8,
    devPoints: 3,
    status: 'to-do',
    source: 'ci-monitor',
    originPrNumber: prNumber,
    ciRunId: runId,
    ciErrorLog: errorLog.slice(0, 3000),
    userId: config.defaultUserId,
    userName: config.defaultUserName || 'Komodo CI Monitor',
  };

  try {
    const taskId = await create('tasks', taskData);
    logger.info(`CI bug task created: ${title} (${taskId})`, AGENT);
    return taskId;
  } catch (err) {
    logger.error(`Failed to create CI bug task: ${err.message}`, AGENT);
    return null;
  }
}

/**
 * Monitors GitHub Actions after a PR merge.
 *
 * Polls for the CI run matching the merge commit, waits for completion,
 * and reacts to pass/fail.
 *
 * @param {object} options
 * @param {number} options.prNumber - Merged PR number
 * @param {string} options.repo - Repository in owner/repo format
 * @param {string} options.projectId - Project ID for bug creation
 * @param {string} [options.mergeCommitSha] - Optional merge commit SHA (auto-detected if not provided)
 * @param {string} [options.taskId] - Original task ID (for auto-revert rollback to to-do)
 * @returns {Promise<CiMonitorResult>}
 *
 * @typedef {object} CiMonitorResult
 * @property {boolean} success - true if CI passed or monitor is disabled
 * @property {boolean} skipped - true if feature is disabled
 * @property {string} [reason] - Reason if skipped
 * @property {boolean} passed - true if CI passed
 * @property {number|null} runId - The workflow run ID (if found)
 * @property {string} [errorLog] - Failed log output (if CI failed)
 * @property {string|null} [bugTaskId] - Created bug task ID (if CI failed)
 */
export async function monitorCi({ prNumber, repo, projectId, mergeCommitSha, taskId }) {
  if (!config.ciMonitor) {
    return { success: true, skipped: true, reason: 'CI_MONITOR disabled', passed: false, runId: null };
  }

  if (!repo) {
    return { success: true, skipped: true, reason: 'No repository specified', passed: false, runId: null };
  }

  logger.info(`Monitoring CI for PR #${prNumber} merge on main...`, AGENT);

  eventBus.emitEvent(EVENT_TYPES.CI_MONITOR_START, {
    metadata: { prNumber, repo },
  });

  // Get merge commit SHA if not provided
  const sha = mergeCommitSha || getMergeCommitSha(repo, prNumber);
  if (!sha) {
    logger.warn(`Could not determine merge commit SHA for PR #${prNumber}. Polling latest runs.`, AGENT);
  }

  const timeoutMs = config.ciMonitorTimeoutMinutes * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const runs = listRuns(repo, 'main');

      // Find matching run by SHA, or fall back to the most recent run
      const run = sha ? findRunForCommit(runs, sha) : (runs[0] || null);

      if (!run) {
        logger.info('No CI runs found yet, waiting...', AGENT);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      // Run still in progress
      if (run.status !== 'completed') {
        logger.info(`CI run #${run.databaseId} status: ${run.status}. Waiting...`, AGENT);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      // Run completed
      if (run.conclusion === 'success') {
        logger.success(`CI passed for PR #${prNumber} merge commit (run #${run.databaseId})`, AGENT);

        eventBus.emitEvent(EVENT_TYPES.CI_PASSED, {
          metadata: { prNumber, runId: run.databaseId, repo },
        });

        return { success: true, skipped: false, passed: true, runId: run.databaseId };
      }

      // CI failed
      logger.error(`CI failed for PR #${prNumber} merge (run #${run.databaseId}, conclusion: ${run.conclusion})`, AGENT);

      const errorLog = getFailedLogs(repo, run.databaseId);

      eventBus.emitEvent(EVENT_TYPES.CI_FAILED, {
        metadata: { prNumber, runId: run.databaseId, errorLog, repo },
      });

      // Auto-revert: revert the merge and return task to to-do
      let revertResult = null;
      if (config.autoRevert) {
        revertResult = autoRevertPR({
          prNumber,
          repo,
          errorLog,
          runId: run.databaseId,
          mergeCommitSha: sha,
        });

        if (revertResult.success && taskId) {
          try {
            await rollbackTaskToTodo(taskId, prNumber, run.databaseId);
          } catch (err) {
            logger.warn(`Could not rollback task ${taskId} to to-do: ${err.message}`, AGENT);
          }
        }
      }

      // Create bug task (only if auto-revert is disabled or failed)
      let bugTaskId = null;
      if (!revertResult?.success) {
        try {
          bugTaskId = await createCiBugTask({ prNumber, runId: run.databaseId, errorLog, projectId, repo });
        } catch (err) {
          logger.warn(`Could not create CI bug task: ${err.message}`, AGENT);
        }
      }

      return {
        success: false,
        skipped: false,
        passed: false,
        runId: run.databaseId,
        errorLog,
        bugTaskId,
        reverted: revertResult?.success || false,
        revertPrNumber: revertResult?.revertPrNumber || null,
      };
    } catch (err) {
      logger.warn(`CI poll error: ${err.message}`, AGENT);
      await delay(POLL_INTERVAL_MS);
    }
  }

  // Timeout
  logger.warn(`CI monitor timed out after ${config.ciMonitorTimeoutMinutes} minutes for PR #${prNumber}`, AGENT);
  return {
    success: false,
    skipped: false,
    passed: false,
    runId: null,
    errorLog: `Timed out after ${config.ciMonitorTimeoutMinutes} minutes`,
  };
}

/**
 * Rolls back a task to to-do status after auto-revert, adding a note about the CI failure.
 *
 * @param {string} taskId - Task ID to rollback
 * @param {number} prNumber - Original PR number
 * @param {number} runId - Failed CI run ID
 */
async function rollbackTaskToTodo(taskId, prNumber, runId) {
  await update('tasks', taskId, {
    status: 'to-do',
    autoRevertNote: `Auto-reverted: CI failed after merging PR #${prNumber} (run #${runId}). Task returned to to-do.`,
    autoRevertedAt: new Date().toISOString(),
  });
  logger.info(`Task ${taskId} returned to to-do after auto-revert`, AGENT);
}
