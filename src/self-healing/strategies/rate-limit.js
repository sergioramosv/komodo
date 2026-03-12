import { fallbackManager } from '../../agents/fallback-manager.js';
import { detectRateLimit, parseRetryAfter } from '../../agents/rate-limit-detector.js';
import { logger } from '../../utils/logger.js';

/**
 * Self-healing strategy for rate limit errors.
 *
 * detect(): delegates to rate-limit-detector patterns.
 * diagnose(): identifies which CLI is rate-limited and retry-after duration.
 * heal(): switches to a fallback CLI or schedules estimated wait.
 */
export const rateLimitStrategy = {
  name: 'rate-limit',

  /**
   * @param {{ errorMessage: string, cli?: string }} errorContext
   * @returns {boolean}
   */
  detect(errorContext) {
    const { errorMessage, cli } = errorContext;
    if (!errorMessage) return false;
    // If cli is known, use specific detection; otherwise scan all CLIs
    const cliToCheck = cli || 'claude';
    return detectRateLimit(errorMessage, cliToCheck).detected;
  },

  /**
   * @param {{ errorMessage: string, cli?: string, agentName?: string }} errorContext
   * @returns {{ cli: string, retryAfterSeconds: number|null, fallbackCli: string|null }}
   */
  diagnose(errorContext) {
    const { errorMessage, cli = 'claude', agentName = 'UNKNOWN' } = errorContext;
    const retryAfterSeconds = parseRetryAfter(errorMessage);
    const fallbackCli = fallbackManager.getAvailableFallbackCli(cli);

    return {
      cli,
      agentName,
      retryAfterSeconds,
      fallbackCli,
    };
  },

  /**
   * @param {{ errorMessage: string, cli?: string, agentName?: string }} errorContext
   * @returns {Promise<{ healed: boolean, action: string, fallbackCli?: string, waitMs?: number }>}
   */
  async heal(errorContext) {
    const diagnosis = this.diagnose(errorContext);
    const { cli, fallbackCli, retryAfterSeconds, agentName } = diagnosis;

    // Mark the CLI as rate-limited
    fallbackManager.markRateLimited(cli);

    if (fallbackCli) {
      logger.info(`Self-healing rate limit: switching ${cli} → ${fallbackCli} for ${agentName}`, 'SELF-HEALING');
      return { healed: true, action: 'fallback-cli', fallbackCli };
    }

    if (retryAfterSeconds) {
      const waitMs = retryAfterSeconds * 1000;
      logger.info(`Self-healing rate limit: waiting ${retryAfterSeconds}s for ${cli} to recover`, 'SELF-HEALING');
      await new Promise(resolve => setTimeout(resolve, waitMs));
      fallbackManager.markRecovered(cli);
      return { healed: true, action: 'waited', waitMs };
    }

    return { healed: false, action: 'no-fallback-available' };
  },
};
