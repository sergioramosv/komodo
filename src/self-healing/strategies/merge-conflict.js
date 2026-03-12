import { spawnSync } from 'child_process';
import { logger } from '../../utils/logger.js';

/** Merge conflict patterns */
const MERGE_CONFLICT_PATTERNS = [
  /CONFLICTING/i,
  /merge conflict/i,
  /conflict.*detected/i,
  /DIRTY/,
  /<<<<<<</,
  />>>>>>>/,
  /cannot.*merge/i,
];

/**
 * Run a git command safely using spawnSync (no shell injection).
 * @param {string[]} args - git subcommand arguments
 * @param {string} cwd
 * @returns {{ success: boolean, output: string }}
 */
function runGitCmd(args, cwd) {
  try {
    const result = spawnSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' });
    if (result.status !== 0) {
      return { success: false, output: result.stderr || result.stdout || '' };
    }
    return { success: true, output: result.stdout || '' };
  } catch (err) {
    return { success: false, output: err.message || '' };
  }
}

/**
 * Self-healing strategy for merge conflicts.
 *
 * Replaces the closePR() fallback with automatic rebase:
 *   git fetch → git rebase origin/main → git push --force-with-lease
 */
export const mergeConflictStrategy = {
  name: 'merge-conflict',

  /**
   * @param {{ errorMessage: string, mergeStatus?: string }} errorContext
   * @returns {boolean}
   */
  detect(errorContext) {
    const { errorMessage = '', mergeStatus } = errorContext;
    if (mergeStatus === 'CONFLICTING' || mergeStatus === 'DIRTY') return true;
    return MERGE_CONFLICT_PATTERNS.some(p => p.test(errorMessage));
  },

  /**
   * @param {{ errorMessage: string, branchName?: string }} errorContext
   * @returns {{ branchName: string|null, requiresRebase: boolean }}
   */
  diagnose(errorContext) {
    const { branchName = null } = errorContext;
    return {
      branchName,
      requiresRebase: true,
    };
  },

  /**
   * Attempt automatic rebase of the feature branch on top of main.
   *
   * @param {{ errorMessage: string, branchName?: string, cwd?: string, baseBranch?: string }} errorContext
   * @returns {Promise<{ healed: boolean, action: string }>}
   */
  async heal(errorContext) {
    const { branchName, cwd = process.cwd(), baseBranch = 'main' } = errorContext;

    if (!branchName) {
      return { healed: false, action: 'no-branch-name' };
    }

    logger.info(`Self-healing merge conflict: rebasing ${branchName} onto ${baseBranch}`, 'SELF-HEALING');

    // 1. Fetch latest
    const fetch = runGitCmd(['fetch', 'origin'], cwd);
    if (!fetch.success) {
      logger.warn(`Self-healing merge conflict: git fetch failed — ${fetch.output}`, 'SELF-HEALING');
      return { healed: false, action: 'fetch-failed' };
    }

    // 2. Checkout branch
    const checkout = runGitCmd(['checkout', branchName], cwd);
    if (!checkout.success) {
      logger.warn(`Self-healing merge conflict: git checkout failed — ${checkout.output}`, 'SELF-HEALING');
      return { healed: false, action: 'checkout-failed' };
    }

    // 3. Rebase
    const rebase = runGitCmd(['rebase', `origin/${baseBranch}`], cwd);
    if (!rebase.success) {
      // Abort rebase on failure to leave repo in clean state
      runGitCmd(['rebase', '--abort'], cwd);
      logger.warn(`Self-healing merge conflict: rebase failed — ${rebase.output}`, 'SELF-HEALING');
      return { healed: false, action: 'rebase-failed' };
    }

    // 4. Force push
    const push = runGitCmd(['push', '--force-with-lease', 'origin', branchName], cwd);
    if (!push.success) {
      logger.warn(`Self-healing merge conflict: push failed — ${push.output}`, 'SELF-HEALING');
      return { healed: false, action: 'push-failed' };
    }

    logger.info(`Self-healing merge conflict: rebase successful for ${branchName}`, 'SELF-HEALING');
    return { healed: true, action: 'rebased' };
  },
};
