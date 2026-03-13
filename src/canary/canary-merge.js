/**
 * Canary Merge — Staging branch strategy with auto-fix and rollback.
 *
 * Flow:
 *   feature → staging/<taskId> → (CI passes) → merge to main
 *
 * If CI fails on staging:
 *   1. Attempt auto-fix with Sonnet (max 5 turns)
 *   2. If auto-fix succeeds → re-run CI on staging
 *   3. If auto-fix fails  → delete staging branch, do NOT touch main
 */

import { execFileSync } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { fixReviewIssues } from '../agents/coder.js';
import { listRuns, getFailedLogs } from '../ci-monitor/ci-monitor.js';

const AGENT = 'CANARY';
const POLL_INTERVAL_MS = 15_000;
const MAX_AUTO_FIX_TURNS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs a git command synchronously in the given cwd.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();
}

/**
 * Runs a gh CLI command synchronously.
 * @param {string[]} args
 * @returns {string}
 */
function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  }).trim();
}

/**
 * Creates (or resets) the staging branch from the feature branch.
 *
 * @param {string} stagingBranch - e.g. "staging/taskId-abc"
 * @param {string} featureBranch - the PR's head branch
 * @param {string} cwd
 */
function createStagingBranch(stagingBranch, featureBranch, repo, cwd) {
  // Make sure we have the latest remote refs
  try { runGit(['fetch', 'origin'], cwd); } catch { /* non-blocking */ }

  // Delete remote staging branch if it exists (clean slate)
  try {
    runGh(['api', `repos/${repo}/git/refs/heads/${stagingBranch}`, '-X', 'DELETE']);
  } catch { /* branch may not exist yet */ }

  // Create staging from feature branch via GitHub API
  // First get the SHA of the feature branch tip
  const sha = runGit(['rev-parse', `origin/${featureBranch}`], cwd);

  runGh([
    'api', `repos/${repo}/git/refs`,
    '-X', 'POST',
    '-f', `ref=refs/heads/${stagingBranch}`,
    '-f', `sha=${sha}`,
  ]);
}

/**
 * Deletes the remote staging branch.
 */
function deleteStagingBranch(stagingBranch, repo) {
  try {
    runGh(['api', `repos/${repo}/git/refs/heads/${stagingBranch}`, '-X', 'DELETE']);
    logger.info(`Staging branch ${stagingBranch} deleted`, AGENT);
  } catch (err) {
    logger.warn(`Could not delete staging branch ${stagingBranch}: ${err.message}`, AGENT);
  }
}

/**
 * Merges main into the staging branch via GitHub merge API (detects conflicts).
 * Returns true if merge succeeded, false if conflicts exist.
 */
function mergeMainIntoStaging(stagingBranch, repo) {
  try {
    runGh([
      'api', `repos/${repo}/merges`,
      '-X', 'POST',
      '-f', `base=${stagingBranch}`,
      '-f', 'head=main',
      '-f', `commit_message=chore: merge main into ${stagingBranch} (pre-validation)`,
    ]);
    return { success: true };
  } catch (err) {
    if (err.status === 409 || err.stderr?.toLowerCase().includes('conflict') || err.message?.toLowerCase().includes('conflict')) {
      return { success: false, reason: 'merge-conflict' };
    }
    return { success: false, reason: err.stderr || err.message || String(err) };
  }
}

/**
 * Polls GitHub Actions for the latest run on the given branch.
 * Returns when the run completes or times out.
 *
 * @param {string} repo
 * @param {string} branch
 * @param {number} timeoutMs
 * @returns {Promise<{ passed: boolean, runId: number|null, errorLog: string|null }>}
 */
async function pollCi(repo, branch, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  logger.info(`Waiting for CI on ${branch}...`, AGENT);
  eventBus.emitEvent(EVENT_TYPES.CANARY_CI_WAITING, { metadata: { branch, repo } });

  // Give GitHub Actions a few seconds to pick up the push
  await delay(10_000);

  while (Date.now() < deadline) {
    try {
      const runs = listRuns(repo, branch, 3);
      const run = runs[0] || null;

      if (!run) {
        logger.info(`No CI runs found on ${branch} yet, waiting...`, AGENT);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      if (run.status !== 'completed') {
        logger.info(`CI run #${run.databaseId} on ${branch}: ${run.status}`, AGENT);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      if (run.conclusion === 'success') {
        logger.success(`CI passed on ${branch} (run #${run.databaseId})`, AGENT);
        eventBus.emitEvent(EVENT_TYPES.CANARY_CI_PASSED, { metadata: { branch, repo, runId: run.databaseId } });
        return { passed: true, runId: run.databaseId, errorLog: null };
      }

      // CI failed
      const errorLog = getFailedLogs(repo, run.databaseId);
      logger.error(`CI failed on ${branch} (run #${run.databaseId}, conclusion: ${run.conclusion})`, AGENT);
      eventBus.emitEvent(EVENT_TYPES.CANARY_CI_FAILED, { metadata: { branch, repo, runId: run.databaseId, errorLog } });
      return { passed: false, runId: run.databaseId, errorLog };
    } catch (err) {
      logger.warn(`CI poll error on ${branch}: ${err.message}`, AGENT);
      await delay(POLL_INTERVAL_MS);
    }
  }

  logger.warn(`CI polling timed out for ${branch}`, AGENT);
  return { passed: false, runId: null, errorLog: 'CI polling timed out' };
}

/**
 * Merges the staging branch into main via squash (promote to main).
 */
function promoteToMain(stagingBranch, repo, prNumber) {
  runGh(['pr', 'merge', String(prNumber), '--repo', repo, '--squash', '--admin']);
  logger.success(`Canary promoted: staging/${stagingBranch} merged to main`, AGENT);
  eventBus.emitEvent(EVENT_TYPES.CANARY_PROMOTED, { metadata: { stagingBranch, repo, prNumber } });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Runs the full canary merge workflow for a task's PR.
 *
 * 1. Creates staging/<taskId> branch from the feature branch.
 * 2. Merges main into staging (pre-validation, detects conflicts).
 * 3. Waits for CI on staging.
 * 4. If CI fails: attempts auto-fix with Sonnet (max 5 turns).
 * 5. If auto-fix succeeds: re-runs CI on staging.
 * 6. If auto-fix fails OR second CI fails: rolls back (deletes staging).
 * 7. If CI passes: promotes staging to main by merging the original PR.
 *
 * @param {object} params
 * @param {object} params.taskSpec - Task specification (taskId, title, branchName, …)
 * @param {number} params.prNumber - The PR number to eventually merge
 * @param {string} params.repo - owner/repo
 * @param {string} params.cwd - Local working directory
 * @param {string} [params.coderModel] - Model for auto-fix attempts
 * @param {string} [params.codingGuidelines] - Guidelines for auto-fix
 * @returns {Promise<{
 *   success: boolean,
 *   promoted: boolean,
 *   rolledBack: boolean,
 *   stagingBranch: string,
 *   autoFixAttempts: number,
 *   reason?: string,
 * }>}
 */
export async function runCanaryMerge({
  taskSpec,
  prNumber,
  repo,
  cwd,
  coderModel,
  codingGuidelines,
}) {
  const stagingBranch = `${config.canaryBranch}/${taskSpec.taskId}`;
  const timeoutMs = config.canaryWaitMinutes * 60 * 1000;
  let autoFixAttempts = 0;

  logger.info(`Starting canary merge: feature → ${stagingBranch} → main`, AGENT);

  // ── Step 1: Create staging branch ──────────────────────────────────────
  try {
    createStagingBranch(stagingBranch, taskSpec.branchName, repo, cwd);
    logger.success(`Staging branch created: ${stagingBranch}`, AGENT);
    eventBus.emitEvent(EVENT_TYPES.CANARY_STAGING_CREATED, {
      metadata: { stagingBranch, featureBranch: taskSpec.branchName, repo },
    });
  } catch (err) {
    logger.error(`Failed to create staging branch ${stagingBranch}: ${err.message}`, AGENT);
    return { success: false, promoted: false, rolledBack: false, stagingBranch, autoFixAttempts, reason: `staging-create-failed: ${err.message}` };
  }

  // ── Step 2: Merge main into staging (conflict detection) ───────────────
  const preValidation = mergeMainIntoStaging(stagingBranch, repo);
  if (!preValidation.success) {
    logger.error(`Pre-merge validation failed for ${stagingBranch}: ${preValidation.reason}`, AGENT);
    deleteStagingBranch(stagingBranch, repo);
    eventBus.emitEvent(EVENT_TYPES.CANARY_ROLLED_BACK, {
      metadata: { stagingBranch, repo, reason: preValidation.reason },
    });
    return { success: false, promoted: false, rolledBack: true, stagingBranch, autoFixAttempts, reason: preValidation.reason };
  }

  // ── Step 3: Wait for CI on staging ────────────────────────────────────
  let ciResult = await pollCi(repo, stagingBranch, timeoutMs);

  // ── Step 4 & 5: Auto-fix loop (max MAX_AUTO_FIX_TURNS attempts) ────────
  if (!ciResult.passed && ciResult.errorLog) {
    for (let attempt = 1; attempt <= MAX_AUTO_FIX_TURNS; attempt++) {
      autoFixAttempts++;
      logger.info(`Auto-fix attempt ${attempt}/${MAX_AUTO_FIX_TURNS} for CI failure on ${stagingBranch}`, AGENT);

      eventBus.emitEvent(EVENT_TYPES.CANARY_AUTO_FIX_ATTEMPT, {
        metadata: { stagingBranch, repo, attempt, errorLog: ciResult.errorLog },
      });

      let fixResult;
      try {
        fixResult = await fixReviewIssues(
          taskSpec,
          prNumber,
          {
            summary: `CI failed on staging branch ${stagingBranch}. Fix the failing tests/build.`,
            issues: [`CI error log:\n${ciResult.errorLog.slice(0, 3000)}`],
          },
          cwd,
          { model: coderModel, codingGuidelines },
        );
      } catch (err) {
        logger.warn(`Auto-fix threw an error (attempt ${attempt}): ${err.message}`, AGENT);
        fixResult = { success: false };
      }

      if (!fixResult.success) {
        logger.warn(`Auto-fix attempt ${attempt} failed`, AGENT);
        break;
      }

      logger.info(`Auto-fix attempt ${attempt} succeeded, re-checking CI on staging...`, AGENT);

      // Re-poll CI after the fix pushed new commits to the feature branch.
      // The staging branch needs to be reset to the new feature HEAD.
      try {
        const newSha = runGit(['rev-parse', `origin/${taskSpec.branchName}`], cwd);
        runGh([
          'api', `repos/${repo}/git/refs/heads/${stagingBranch}`,
          '-X', 'PATCH',
          '-f', `sha=${newSha}`,
          '-F', 'force=true',
        ]);
      } catch (err) {
        logger.warn(`Could not update staging branch after auto-fix: ${err.message}`, AGENT);
        break;
      }

      ciResult = await pollCi(repo, stagingBranch, timeoutMs);

      if (ciResult.passed) {
        eventBus.emitEvent(EVENT_TYPES.CANARY_AUTO_FIX_SUCCEEDED, {
          metadata: { stagingBranch, repo, attempt },
        });
        break;
      }
    }
  }

  // ── Step 6: Rollback if CI still failing ──────────────────────────────
  if (!ciResult.passed) {
    logger.error(`Canary rollback: CI did not pass on ${stagingBranch} after ${autoFixAttempts} fix attempt(s)`, AGENT);

    if (autoFixAttempts > 0) {
      eventBus.emitEvent(EVENT_TYPES.CANARY_AUTO_FIX_FAILED, {
        metadata: { stagingBranch, repo, attempts: autoFixAttempts },
      });
    }

    deleteStagingBranch(stagingBranch, repo);
    eventBus.emitEvent(EVENT_TYPES.CANARY_ROLLED_BACK, {
      metadata: { stagingBranch, repo, reason: 'ci-failed', errorLog: ciResult.errorLog },
    });

    return {
      success: false,
      promoted: false,
      rolledBack: true,
      stagingBranch,
      autoFixAttempts,
      reason: 'ci-failed-on-staging',
    };
  }

  // ── Step 7: Promote to main ────────────────────────────────────────────
  if (config.canaryAutoPromote) {
    try {
      promoteToMain(stagingBranch, repo, prNumber);
      deleteStagingBranch(stagingBranch, repo);
      return { success: true, promoted: true, rolledBack: false, stagingBranch, autoFixAttempts };
    } catch (err) {
      logger.error(`Failed to promote staging to main: ${err.message}`, AGENT);
      deleteStagingBranch(stagingBranch, repo);
      return {
        success: false,
        promoted: false,
        rolledBack: true,
        stagingBranch,
        autoFixAttempts,
        reason: `promote-failed: ${err.message}`,
      };
    }
  }

  // canaryAutoPromote=false → CI passed but caller handles the merge
  logger.info(`CANARY_AUTO_PROMOTE=false → staging ${stagingBranch} ready, waiting for manual promotion.`, AGENT);
  return { success: true, promoted: false, rolledBack: false, stagingBranch, autoFixAttempts };
}
