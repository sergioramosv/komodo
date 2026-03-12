import { logger } from '../../utils/logger.js';

/** HTTP 5xx / network error patterns from gh CLI */
const GITHUB_API_ERROR_PATTERNS = [
  /\b5\d{2}\b/,             // 500, 502, 503, 504…
  /server error/i,
  /internal server error/i,
  /service unavailable/i,
  /bad gateway/i,
  /connection refused/i,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
  /network.*error/i,
  /gh:.*failed/i,
  /could not resolve host/i,
];

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

/**
 * Self-healing strategy for GitHub API errors (5xx, network, gh CLI failures).
 *
 * Implements retry with exponential backoff up to MAX_ATTEMPTS.
 */
export const githubApiErrorStrategy = {
  name: 'github-api-error',

  /**
   * @param {{ errorMessage: string }} errorContext
   * @returns {boolean}
   */
  detect(errorContext) {
    const { errorMessage } = errorContext;
    if (!errorMessage) return false;
    return GITHUB_API_ERROR_PATTERNS.some(p => p.test(errorMessage));
  },

  /**
   * @param {{ errorMessage: string }} errorContext
   * @returns {{ matchedPattern: string|null }}
   */
  diagnose(errorContext) {
    const { errorMessage } = errorContext;
    const matched = GITHUB_API_ERROR_PATTERNS.find(p => p.test(errorMessage));
    return { matchedPattern: matched ? matched.source : null };
  },

  /**
   * Retry the provided action with exponential backoff.
   *
   * @param {{ errorMessage: string, action?: () => Promise<any> }} errorContext
   * @returns {Promise<{ healed: boolean, attempts: number, result?: any }>}
   */
  async heal(errorContext) {
    const { action } = errorContext;

    if (typeof action !== 'function') {
      return { healed: false, attempts: 0, reason: 'no-action-provided' };
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.info(`Self-healing GitHub API error: attempt ${attempt}/${MAX_ATTEMPTS} (delay ${delayMs}ms)`, 'SELF-HEALING');

      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      try {
        const result = await action();
        return { healed: true, attempts: attempt, result };
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn(`Self-healing GitHub API error: exhausted after ${MAX_ATTEMPTS} attempts — ${err.message}`, 'SELF-HEALING');
          return { healed: false, attempts: attempt };
        }
        // continue retrying
      }
    }

    return { healed: false, attempts: MAX_ATTEMPTS };
  },
};
