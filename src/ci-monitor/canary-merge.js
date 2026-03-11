import { execFileSync } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { update } from '../../skills/planning-task-mcp/src/firebase.js';
import { runGhCommand, listRuns, getFailedLogs, findRunForCommit } from './ci-monitor.js';
import { runCanaryAutoFix } from './canary-auto-fix.js';

const AGENT = 'CANARY-MERGE';
const POLL_INTERVAL_MS = 15_000;
const GIT_TIMEOUT = 30_000;

/**
 * Runs a git command in the given working directory.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string} stdout trimmed
 */
function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT,
  }).trim();
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gets the current HEAD SHA in the working directory.
 *
 * @param {string} cwd
 * @returns {string}
 */
function getHeadSha(cwd) {
  return runGit(['rev-parse', 'HEAD'], cwd);
}

/**
 * Checks whether a remote branch exists.
 *
 * @param {string} branchName
 * @param {string} repo - owner/repo
 * @returns {boolean}
 */
function remoteBranchExists(branchName, repo) {
  try {
    const refs = runGhCommand([
      'api', `repos/${repo}/git/refs/heads/${branchName}`,
    ]);
    return !!refs;
  } catch {
    return false;
  }
}

/**
 * Ensures the staging branch exists remotely and is checked out locally.
 * Creates it from main if it doesn't exist.
 *
 * @param {string} stagingBranch
 * @param {string} repo
 * @param {string} cwd
 */
function ensureStagingBranch(stagingBranch, repo, cwd) {
  runGit(['fetch', 'origin'], cwd);

  const exists = remoteBranchExists(stagingBranch, repo);

  if (!exists) {
    logger.info(`Staging branch "${stagingBranch}" does not exist — creating from main`, AGENT);
    runGit(['checkout', '-b', stagingBranch, 'origin/main'], cwd);
    runGit(['push', 'origin', stagingBranch], cwd);
    logger.info(`Created and pushed "${stagingBranch}"`, AGENT);
  } else {
    // Checkout or reset staging to origin/main to start clean
    try {
      runGit(['checkout', stagingBranch], cwd);
      runGit(['reset', '--hard', 'origin/main'], cwd);
    } catch {
      runGit(['checkout', '-b', stagingBranch, `origin/${stagingBranch}`], cwd);
      runGit(['reset', '--hard', 'origin/main'], cwd);
    }
    logger.info(`Staging branch "${stagingBranch}" reset to origin/main`, AGENT);
  }
}

/**
 * Detects pre-merge conflicts by attempting a --no-commit merge on a temp branch.
 *
 * @param {string} featureBranch - Branch to merge into main
 * @param {string} cwd - Working directory
 * @returns {{ conflicting: boolean, message: string }}
 */
export function detectPreMergeConflicts(featureBranch, cwd) {
  const tempBranch = `canary-precheck-${Date.now()}`;
  const originalBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

  try {
    runGit(['fetch', 'origin'], cwd);
    runGit(['checkout', '-b', tempBranch, 'origin/main'], cwd);

    try {
      runGit(['merge', '--no-commit', '--no-ff', `origin/${featureBranch}`], cwd);
      // No conflict — abort the in-progress merge to clean up
      try { runGit(['merge', '--abort'], cwd); } catch { /* nothing to abort */ }
      return { conflicting: false, message: 'No conflicts detected' };
    } catch (mergeErr) {
      // Conflict detected
      try { runGit(['merge', '--abort'], cwd); } catch { /* best effort */ }
      return { conflicting: true, message: mergeErr.message };
    }
  } finally {
    // Always restore original branch and clean up temp branch
    try { runGit(['checkout', originalBranch], cwd); } catch { /* ignore */ }
    try { runGit(['branch', '-D', tempBranch], cwd); } catch { /* ignore */ }
  }
}

/**
 * Runs the local test suite in the given working directory.
 * Throws if tests fail.
 *
 * @param {string} cwd
 */
function runLocalTests(cwd) {
  try {
    execFileSync('npm', ['test'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
  } catch (err) {
    const parts = [err.message];
    if (err.stdout) parts.push(`stdout:\n${err.stdout}`);
    if (err.stderr) parts.push(`stderr:\n${err.stderr}`);
    throw new Error(parts.join('\n'));
  }
}

/**
 * Polls GitHub Actions CI for a specific branch and commit SHA.
 *
 * @param {string} repo
 * @param {string} branch
 * @param {string} commitSha
 * @param {number} timeoutMs
 * @returns {Promise<{ passed: boolean, runId: number|null, errorLog: string }>}
 */
async function pollCiForBranch(repo, branch, commitSha, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const runs = listRuns(repo, branch, 5);
      const run = commitSha ? findRunForCommit(runs, commitSha) : (runs[0] || null);

      if (!run) {
        logger.info(`No CI runs found on "${branch}" yet, waiting...`, AGENT);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      if (run.status !== 'completed') {
        logger.info(`CI run #${run.databaseId} on "${branch}" status: ${run.status}. Waiting...`, AGENT);
        await delay(POLL_INTERVAL_MS);
        continue;
      }

      if (run.conclusion === 'success') {
        logger.success(`CI passed on "${branch}" (run #${run.databaseId})`, AGENT);
        return { passed: true, runId: run.databaseId, errorLog: '' };
      }

      const errorLog = getFailedLogs(repo, run.databaseId);
      logger.error(`CI failed on "${branch}" (run #${run.databaseId})`, AGENT);
      return { passed: false, runId: run.databaseId, errorLog };
    } catch (err) {
      logger.warn(`CI poll error on "${branch}": ${err.message}`, AGENT);
      await delay(POLL_INTERVAL_MS);
    }
  }

  logger.warn(`CI poll timed out on "${branch}" after ${timeoutMs / 60000} minutes`, AGENT);
  return { passed: false, runId: null, errorLog: 'CI polling timed out' };
}

/**
 * Promotes the staging branch to main via a squash merge.
 *
 * @param {string} stagingBranch
 * @param {string} repo
 * @param {number} stagingPrNumber
 * @returns {boolean} true on success
 */
function promoteToMain(stagingBranch, repo, stagingPrNumber) {
  try {
    runGhCommand(['pr', 'merge', String(stagingPrNumber), '--squash', '--auto'], { repo });
    return true;
  } catch (err) {
    // Fallback: try merge without --auto
    try {
      runGhCommand(['pr', 'merge', String(stagingPrNumber), '--squash'], { repo });
      return true;
    } catch (err2) {
      logger.error(`Failed to promote staging to main: ${err2.message}`, AGENT);
      return false;
    }
  }
}

/**
 * Reverts staging branch back to main HEAD without touching main.
 *
 * @param {string} stagingBranch
 * @param {string} repo
 * @param {string} cwd
 */
function revertStaging(stagingBranch, repo, cwd) {
  try {
    runGit(['fetch', 'origin'], cwd);
    runGit(['checkout', stagingBranch], cwd);
    runGit(['reset', '--hard', 'origin/main'], cwd);
    runGit(['push', 'origin', stagingBranch, '--force-with-lease'], cwd);
    logger.info(`Staging branch "${stagingBranch}" reverted to origin/main`, AGENT);
  } catch (err) {
    logger.error(`Failed to revert staging branch: ${err.message}`, AGENT);
  }
}

/**
 * Rolls back a task to to-do status in Firebase.
 *
 * @param {string} taskId
 * @param {string} note
 */
async function rollbackTaskStatus(taskId, note) {
  try {
    await update('tasks', taskId, {
      status: 'to-do',
      autoRevertNote: note,
      autoRevertedAt: new Date().toISOString(),
    });
    logger.info(`Task ${taskId} rolled back to to-do`, AGENT);
  } catch (err) {
    logger.warn(`Could not rollback task ${taskId}: ${err.message}`, AGENT);
  }
}

/**
 * Creates a PR from the staging branch to main.
 *
 * @param {string} stagingBranch
 * @param {string} repo
 * @param {number} originalPrNumber
 * @returns {number|null} staging PR number or null
 */
function createStagingPr(stagingBranch, repo, originalPrNumber) {
  // Check for an existing open PR from stagingBranch → main to handle retries
  try {
    const existing = runGhCommand([
      'pr', 'list',
      '--base', 'main',
      '--head', stagingBranch,
      '--state', 'open',
      '--json', 'number',
      '--jq', '.[0].number',
    ], { repo });
    const existingNumber = existing ? parseInt(String(existing).trim(), 10) : NaN;
    if (!isNaN(existingNumber) && existingNumber > 0) {
      logger.info(`Staging PR #${existingNumber} already exists for "${stagingBranch}" → main — reusing`, AGENT);
      return existingNumber;
    }
  } catch {
    // gh pr list failure is non-fatal; proceed to create
  }

  try {
    const result = runGhCommand([
      'pr', 'create',
      '--base', 'main',
      '--head', stagingBranch,
      '--title', `[Canary] Promote ${stagingBranch} to main (from PR #${originalPrNumber})`,
      '--body', `Auto-created canary staging PR. Promotes \`${stagingBranch}\` → \`main\` after CI passed.\n\nOrigin PR: #${originalPrNumber}`,
    ], { repo });

    // result may be the PR URL or an object
    if (typeof result === 'string') {
      const match = result.match(/\/pull\/(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    }
    return result?.number || null;
  } catch (err) {
    logger.warn(`Could not create staging PR: ${err.message}`, AGENT);
    return null;
  }
}

/**
 * Full canary merge pipeline.
 *
 * Flow:
 * 1. Pre-merge conflict detection (checkout temp branch, merge --no-commit)
 * 2. Merge feature branch into staging
 * 3. Push staging, poll CI
 * 4. If CI passes → promote staging to main (create staging PR + merge)
 * 5. If CI fails → run auto-fix (max 5 turns), retry CI
 * 6. If auto-fix also fails → revert staging, rollback task
 *
 * @param {object} options
 * @param {number} options.prNumber - Feature PR number (already approved, ready to merge)
 * @param {string} options.repo - owner/repo
 * @param {object} options.taskSpec - Task specification
 * @param {string} options.cwd - Working directory
 * @param {string} options.projectId - Firebase project ID
 * @param {string} options.taskId - Firebase task ID
 * @param {string[]} [options.filesChanged] - Files changed by the Coder
 * @param {string} [options.coderModel] - Model for auto-fix
 * @param {string} [options.codingGuidelines] - Coding guidelines for auto-fix
 * @returns {Promise<{ success: boolean, promoted: boolean, reverted: boolean, autoFixed: boolean, stagingPrNumber?: number, error?: string }>}
 */
export async function canaryMerge({
  prNumber,
  repo,
  taskSpec,
  cwd,
  projectId,
  taskId,
  filesChanged = [],
  coderModel,
  codingGuidelines,
}) {
  const stagingBranch = config.canaryBranch;
  const waitMs = config.canaryWaitMinutes * 60 * 1000;
  const featureBranch = taskSpec.branchName;

  logger.info(`Canary merge: PR #${prNumber} → "${stagingBranch}" → main`, AGENT);

  eventBus.emitEvent(EVENT_TYPES.CANARY_MERGE_START, {
    metadata: { prNumber, repo, featureBranch, stagingBranch },
  });

  // Step 1: Pre-merge validation — conflict detection + local test suite
  try {
    const conflictCheck = detectPreMergeConflicts(featureBranch, cwd);
    if (conflictCheck.conflicting) {
      logger.error(`Pre-merge conflict detected for PR #${prNumber}: ${conflictCheck.message}`, AGENT);
      return {
        success: false,
        promoted: false,
        reverted: false,
        autoFixed: false,
        error: `Pre-merge conflict: ${conflictCheck.message}`,
      };
    }
    logger.info('Pre-merge conflict check passed', AGENT);
  } catch (err) {
    logger.warn(`Pre-merge conflict check failed (non-blocking): ${err.message}`, AGENT);
  }

  try {
    logger.info('Running local test suite before merge...', AGENT);
    runLocalTests(cwd);
    logger.info('Local test suite passed', AGENT);
  } catch (err) {
    logger.error(`Local tests failed before merge: ${err.message}`, AGENT);
    return {
      success: false,
      promoted: false,
      reverted: false,
      autoFixed: false,
      error: `Pre-merge local tests failed: ${err.message}`,
    };
  }

  // Step 2: Ensure staging branch exists and is reset to main
  try {
    ensureStagingBranch(stagingBranch, repo, cwd);
  } catch (err) {
    return {
      success: false,
      promoted: false,
      reverted: false,
      autoFixed: false,
      error: `Could not prepare staging branch: ${err.message}`,
    };
  }

  // Step 3: Merge feature branch into staging
  try {
    runGit(['fetch', 'origin', featureBranch], cwd);
    runGit(['merge', '--no-ff', `origin/${featureBranch}`, '-m', `Canary: merge ${featureBranch} into ${stagingBranch}`], cwd);
    runGit(['push', 'origin', stagingBranch], cwd);
    logger.info(`Feature branch "${featureBranch}" merged into staging "${stagingBranch}"`, AGENT);
  } catch (err) {
    return {
      success: false,
      promoted: false,
      reverted: false,
      autoFixed: false,
      error: `Failed to merge feature into staging: ${err.message}`,
    };
  }

  const stagingHeadSha = getHeadSha(cwd);

  // If canaryWaitMinutes is 0 and canaryAutoPromote, skip CI and promote directly.
  // WARNING: this bypasses CI validation entirely — only use in local/dev environments.
  if (config.canaryWaitMinutes === 0 && config.canaryAutoPromote) {
    logger.warn(
      'WARNING: CANARY_WAIT_MINUTES=0 + CANARY_AUTO_PROMOTE=true — CI validation is being bypassed. ' +
      'Set CANARY_WAIT_MINUTES > 0 in production to ensure CI runs before promotion.',
      AGENT,
    );
    eventBus.emitEvent(EVENT_TYPES.CANARY_CI_BYPASSED ?? 'canary:ci-bypassed', {
      metadata: { prNumber, repo, stagingBranch, reason: 'CANARY_WAIT_MINUTES=0' },
    });
    return await _promoteStagingToMain({ stagingBranch, repo, cwd, prNumber, taskId, projectId });
  }

  // Step 4: Poll CI on staging
  logger.info(`Waiting for CI on staging branch "${stagingBranch}"...`, AGENT);
  let ciResult = await pollCiForBranch(repo, stagingBranch, stagingHeadSha, waitMs);

  if (ciResult.passed) {
    eventBus.emitEvent(EVENT_TYPES.CANARY_CI_PASSED, {
      metadata: { prNumber, repo, stagingBranch, runId: ciResult.runId },
    });

    if (config.canaryAutoPromote) {
      return await _promoteStagingToMain({ stagingBranch, repo, cwd, prNumber, taskId, projectId });
    }

    logger.info('CANARY_AUTO_PROMOTE=false — staging CI passed, awaiting manual promotion', AGENT);
    return { success: true, promoted: false, reverted: false, autoFixed: false };
  }

  // CI failed on staging
  eventBus.emitEvent(EVENT_TYPES.CANARY_CI_FAILED, {
    metadata: { prNumber, repo, stagingBranch, runId: ciResult.runId, errorLog: ciResult.errorLog },
  });

  // Step 5: Attempt auto-fix
  eventBus.emitEvent(EVENT_TYPES.CANARY_AUTO_FIX_START, {
    metadata: { prNumber, repo, stagingBranch },
  });

  const fixResult = await runCanaryAutoFix({
    taskSpec,
    branchName: stagingBranch,
    repo,
    cwd,
    errorLog: ciResult.errorLog,
    coderModel,
    codingGuidelines,
  });

  if (fixResult.fixed) {
    // Re-poll CI after fix
    const fixedSha = getHeadSha(cwd);
    logger.info('Auto-fix applied — re-polling CI on staging...', AGENT);
    ciResult = await pollCiForBranch(repo, stagingBranch, fixedSha, waitMs);

    if (ciResult.passed) {
      eventBus.emitEvent(EVENT_TYPES.CANARY_AUTO_FIX_SUCCESS, {
        metadata: { prNumber, repo, stagingBranch },
      });

      if (config.canaryAutoPromote) {
        return await _promoteStagingToMain({ stagingBranch, repo, cwd, prNumber, taskId, projectId, autoFixed: true });
      }

      return { success: true, promoted: false, reverted: false, autoFixed: true };
    }
  }

  // Auto-fix failed or CI still failing — revert staging, rollback task
  eventBus.emitEvent(EVENT_TYPES.CANARY_AUTO_FIX_FAILED, {
    metadata: { prNumber, repo, stagingBranch, fixError: fixResult.error },
  });

  logger.warn(`Canary auto-fix failed or CI still failing on staging — reverting "${stagingBranch}"`, AGENT);

  revertStaging(stagingBranch, repo, cwd);

  eventBus.emitEvent(EVENT_TYPES.CANARY_REVERTED, {
    metadata: { prNumber, repo, stagingBranch },
  });

  await rollbackTaskStatus(
    taskId,
    `Canary merge failed: CI failed on staging "${stagingBranch}" after auto-fix attempt for PR #${prNumber}. Task returned to to-do.`
  );

  return {
    success: false,
    promoted: false,
    reverted: true,
    autoFixed: false,
    error: `Canary CI failed on staging and auto-fix did not resolve it`,
  };
}

/**
 * Helper: create staging PR and merge to main, emit CANARY_PROMOTED.
 *
 * @param {object} opts
 * @param {string} opts.stagingBranch
 * @param {string} opts.repo
 * @param {string} opts.cwd
 * @param {number} opts.prNumber
 * @param {string} opts.taskId
 * @param {string} opts.projectId
 * @param {boolean} [opts.autoFixed]
 * @returns {Promise<{ success: boolean, promoted: boolean, reverted: boolean, autoFixed: boolean, stagingPrNumber?: number }>}
 */
async function _promoteStagingToMain({ stagingBranch, repo, cwd, prNumber, taskId, projectId, autoFixed = false }) {
  logger.info(`Promoting staging "${stagingBranch}" to main...`, AGENT);

  const stagingPrNumber = createStagingPr(stagingBranch, repo, prNumber);

  let promoted = false;
  if (stagingPrNumber) {
    promoted = promoteToMain(stagingBranch, repo, stagingPrNumber);
  } else {
    // Fallback: direct push to main is not safe — log error
    logger.error('Could not create staging PR for promotion. Skipping merge to main.', AGENT);
  }

  if (promoted) {
    eventBus.emitEvent(EVENT_TYPES.CANARY_PROMOTED, {
      metadata: { prNumber, repo, stagingBranch, stagingPrNumber, autoFixed },
    });
    logger.success(`Canary merge succeeded: staging promoted to main (staging PR #${stagingPrNumber})`, AGENT);
  } else {
    logger.error(`Failed to promote staging to main. Staging PR: ${stagingPrNumber} — reverting staging and rolling back task`, AGENT);
    // Cleanup: staging has feature merged in but never reached main — revert it
    revertStaging(stagingBranch, repo, cwd);
    eventBus.emitEvent(EVENT_TYPES.CANARY_REVERTED, {
      metadata: { prNumber, repo, stagingBranch },
    });
    await rollbackTaskStatus(
      taskId,
      `Canary promotion failed: could not merge staging "${stagingBranch}" to main via PR #${stagingPrNumber ?? 'unknown'} for feature PR #${prNumber}. Task returned to to-do.`,
    );
  }

  return {
    success: promoted,
    promoted,
    reverted: !promoted,
    autoFixed,
    stagingPrNumber: stagingPrNumber || undefined,
  };
}
