// src/estimation/rate-limit-tracker.js

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT_TAG = 'RATE_LIMIT_TRACKER';

/**
 * Singleton that maintains a sliding window of estimated token consumption
 * and calculates available headroom before the budget resets.
 *
 * Since CLIs don't expose token usage via API, this tracker uses estimated
 * token values. It's an approximation — but conservative enough for MVP.
 */
class RateLimitTracker {
  constructor() {
    /** @type {Array<{ timestamp: number, tokens: number }>} */
    this._window = [];
  }

  /**
   * Records estimated token consumption for a task.
   * @param {number} tokens - Estimated tokens to record
   */
  recordTokenConsumption(tokens) {
    const now = Date.now();
    this._window.push({ timestamp: now, tokens });
    this._evictExpired(now);

    const used = this._sumWindow();
    logger.debug(
      `Recorded ${tokens} tokens. Window total: ${used} / ${config.rateLimitTokenBudget}`,
      AGENT_TAG,
    );
  }

  /**
   * Returns headroom: how many tokens are still available in the current window,
   * and when the oldest entry (reset point) expires.
   *
   * @returns {{ availableTokens: number, resetTime: number, usedTokens: number }}
   */
  getHeadroom() {
    const now = Date.now();
    this._evictExpired(now);

    const used = this._sumWindow();
    const available = Math.max(0, config.rateLimitTokenBudget - used);

    // Reset time: when the oldest entry in the window expires
    const resetTime =
      this._window.length > 0
        ? this._window[0].timestamp + config.rateLimitTokenWindowMs
        : now + config.rateLimitTokenWindowMs;

    logger.debug(
      `Headroom: ${available} available (${used} used of ${config.rateLimitTokenBudget})`,
      AGENT_TAG,
    );

    return { availableTokens: available, resetTime, usedTokens: used };
  }

  /**
   * Resets the sliding window (useful for testing).
   */
  reset() {
    this._window = [];
  }

  /** @private */
  _evictExpired(now) {
    const cutoff = now - config.rateLimitTokenWindowMs;
    this._window = this._window.filter(entry => entry.timestamp > cutoff);
  }

  /** @private */
  _sumWindow() {
    return this._window.reduce((sum, entry) => sum + entry.tokens, 0);
  }
}

/** Singleton instance */
export const rateLimitTracker = new RateLimitTracker();

/**
 * Records estimated token consumption in the sliding window.
 * @param {number} tokens
 */
export function recordTokenConsumption(tokens) {
  rateLimitTracker.recordTokenConsumption(tokens);
}

/**
 * Returns the current rate limit headroom.
 * @returns {{ availableTokens: number, resetTime: number, usedTokens: number }}
 */
export function getRateLimitHeadroom() {
  return rateLimitTracker.getHeadroom();
}
