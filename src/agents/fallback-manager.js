import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { cliExists } from '../config.js';

/**
 * Manages CLI fallback when rate limits are detected.
 *
 * Tracks which CLIs are currently rate-limited (with TTL-based cooldown)
 * and provides alternative CLIs from a configurable fallback order.
 */
class FallbackManager {
  constructor() {
    /** @type {Map<string, number>} CLI name → timestamp when rate limit was detected */
    this._rateLimitedClis = new Map();
  }

  /**
   * Whether fallback is enabled via configuration.
   * @returns {boolean}
   */
  isEnabled() {
    return config.rateLimitFallback;
  }

  /**
   * Get the cooldown duration in milliseconds.
   * @returns {number}
   */
  get cooldownMs() {
    return config.rateLimitCooldownMinutes * 60 * 1000;
  }

  /**
   * Mark a CLI as rate-limited. It will be excluded from fallback
   * selection until the cooldown period expires.
   *
   * @param {string} cli - CLI identifier (claude, codex, gemini)
   */
  markRateLimited(cli) {
    this._rateLimitedClis.set(cli, Date.now());
    logger.warn(`CLI "${cli}" marked as rate-limited (cooldown: ${config.rateLimitCooldownMinutes}min)`, 'KOMODO');
  }

  /**
   * Check if a CLI is currently in rate limit cooldown.
   *
   * @param {string} cli - CLI identifier
   * @returns {boolean}
   */
  isRateLimited(cli) {
    const timestamp = this._rateLimitedClis.get(cli);
    if (!timestamp) return false;

    const elapsed = Date.now() - timestamp;
    if (elapsed >= this.cooldownMs) {
      // Cooldown expired — remove from map
      this._rateLimitedClis.delete(cli);
      return false;
    }

    return true;
  }

  /**
   * Get all CLIs currently in rate limit cooldown.
   * @returns {string[]}
   */
  getRateLimitedClis() {
    // Clean expired entries first
    for (const [cli, timestamp] of this._rateLimitedClis) {
      if (Date.now() - timestamp >= this.cooldownMs) {
        this._rateLimitedClis.delete(cli);
      }
    }
    return [...this._rateLimitedClis.keys()];
  }

  /**
   * Get the configured fallback CLI order.
   * @returns {string[]}
   */
  getFallbackOrder() {
    return config.fallbackCliOrder;
  }

  /**
   * Find an available fallback CLI for a given role.
   *
   * Walks the FALLBACK_CLI_ORDER list and returns the first CLI that:
   * 1. Is different from the failed CLI
   * 2. Is NOT currently rate-limited
   * 3. Is installed on the system
   *
   * @param {string} failedCli - The CLI that hit rate limit
   * @returns {string|null} Available fallback CLI, or null if none available
   */
  getAvailableFallbackCli(failedCli) {
    if (!this.isEnabled()) return null;

    const order = this.getFallbackOrder();
    if (order.length === 0) return null;

    for (const cli of order) {
      if (cli === failedCli) continue;
      if (this.isRateLimited(cli)) continue;
      if (!cliExists(cli)) continue;
      return cli;
    }

    return null;
  }

  /**
   * Resolve the effective CLI to use for a given role.
   *
   * If the configured CLI is rate-limited and fallback is enabled,
   * returns a fallback CLI. Otherwise returns the original CLI.
   *
   * @param {string} originalCli - The configured CLI for this role
   * @param {string} agentRole - Agent role (PLANNER, CODER, REVIEWER)
   * @returns {{ cli: string, isFallback: boolean }}
   */
  resolveEffectiveCli(originalCli, agentRole) {
    if (!this.isEnabled() || !this.isRateLimited(originalCli)) {
      return { cli: originalCli, isFallback: false };
    }

    const fallbackCli = this.getAvailableFallbackCli(originalCli);
    if (!fallbackCli) {
      return { cli: originalCli, isFallback: false };
    }

    // Emit fallback event
    eventBus.emitEvent(EVENT_TYPES.AGENT_FALLBACK, {
      agentName: agentRole,
      metadata: {
        originalCli,
        fallbackCli,
        agentRole,
      },
    });

    logger.info(`Fallback: ${originalCli} -> ${fallbackCli} for ${agentRole}`, 'KOMODO');

    return { cli: fallbackCli, isFallback: true };
  }

  /**
   * Clear all rate limit records. Used on orchestrator reset.
   */
  clear() {
    this._rateLimitedClis.clear();
  }
}

/** Singleton instance. */
export const fallbackManager = new FallbackManager();
