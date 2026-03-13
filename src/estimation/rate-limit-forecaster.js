// src/estimation/rate-limit-forecaster.js

import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

const AGENT_TAG = 'RATE_LIMIT_FORECASTER';

/** Window size: 2 hours in milliseconds */
const WINDOW_MS = 2 * 60 * 60 * 1000;

/** Minimum data points required to consider the forecast confident */
const MIN_CONFIDENT_POINTS = 3;

/** Thresholds for recommendation levels (in minutes) */
const THRESHOLDS = {
  GREEN: 60,   // > 60 min → green
  YELLOW: 20,  // > 20 min → yellow
  ORANGE: 5,   // > 5 min  → orange
  // ≤ 5 min   → red (stop)
};

/**
 * RateLimitForecaster maintains a per-CLI sliding window of token consumption
 * over the last 2 hours and projects when each CLI will hit its rate limit.
 */
class RateLimitForecaster {
  constructor() {
    /**
     * Per-CLI consumption history.
     * @type {Map<string, Array<{ timestamp: number, tokens: number }>>}
     */
    this._history = new Map();
  }

  /**
   * Records token consumption for a given CLI.
   *
   * @param {string} cli - CLI identifier (e.g. config.cliCoder)
   * @param {number} tokens - Estimated tokens consumed
   */
  record(cli, tokens) {
    if (!cli || typeof tokens !== 'number' || tokens < 0) return;

    const now = Date.now();
    if (!this._history.has(cli)) {
      this._history.set(cli, []);
    }

    const entries = this._history.get(cli);
    entries.push({ timestamp: now, tokens });
    this._evictExpired(cli, now);

    logger.debug(`Recorded ${tokens} tokens for CLI "${cli}"`, AGENT_TAG);
  }

  /**
   * Returns a forecast for the given CLI.
   *
   * @param {string} cli - CLI identifier
   * @param {number} rateLimitBudget - Total token budget per window (e.g. from config)
   * @returns {{
   *   cli: string,
   *   tokensPerMinute: number,
   *   projectedUsage: number,
   *   estimatedHeadroom: number,
   *   minutesToRateLimit: number,
   *   recommendation: 'green'|'yellow'|'orange'|'red',
   *   confident: boolean,
   * }}
   */
  forecast(cli, rateLimitBudget) {
    const now = Date.now();
    this._evictExpired(cli, now);

    const entries = this._history.get(cli) || [];
    const confident = entries.length >= MIN_CONFIDENT_POINTS;

    if (entries.length === 0) {
      return {
        cli,
        tokensPerMinute: 0,
        projectedUsage: 0,
        estimatedHeadroom: rateLimitBudget,
        minutesToRateLimit: Infinity,
        recommendation: 'green',
        confident: false,
      };
    }

    // Total tokens consumed in the window
    const usedTokens = entries.reduce((sum, e) => sum + e.tokens, 0);

    // Elapsed time in minutes (from oldest entry to now)
    const oldestTs = entries[0].timestamp;
    const elapsedMs = now - oldestTs;
    const elapsedMinutes = elapsedMs / 60_000 || 1; // avoid division by zero

    const tokensPerMinute = usedTokens / elapsedMinutes;

    // Projected total usage over the full 2-hour window
    const windowMinutes = WINDOW_MS / 60_000;
    const projectedUsage = tokensPerMinute * windowMinutes;

    // Remaining headroom
    const estimatedHeadroom = Math.max(0, rateLimitBudget - usedTokens);

    // Minutes until rate limit based on current consumption rate
    const minutesToRateLimit =
      tokensPerMinute > 0
        ? estimatedHeadroom / tokensPerMinute
        : Infinity;

    const recommendation = this._getRecommendation(minutesToRateLimit);

    return {
      cli,
      tokensPerMinute: Math.round(tokensPerMinute),
      projectedUsage: Math.round(projectedUsage),
      estimatedHeadroom,
      minutesToRateLimit: isFinite(minutesToRateLimit)
        ? Math.round(minutesToRateLimit)
        : Infinity,
      recommendation,
      confident,
    };
  }

  /**
   * Resets history for all CLIs (useful for testing).
   */
  reset() {
    this._history.clear();
  }

  /** @private */
  _evictExpired(cli, now) {
    const entries = this._history.get(cli);
    if (!entries) return;

    const cutoff = now - WINDOW_MS;
    const pruned = entries.filter(e => e.timestamp > cutoff);
    this._history.set(cli, pruned);
  }

  /** @private */
  _getRecommendation(minutesToRateLimit) {
    if (minutesToRateLimit > THRESHOLDS.GREEN) return 'green';
    if (minutesToRateLimit > THRESHOLDS.YELLOW) return 'yellow';
    if (minutesToRateLimit > THRESHOLDS.ORANGE) return 'orange';
    return 'red';
  }
}

/** Singleton instance */
export const rateLimitForecaster = new RateLimitForecaster();

/**
 * Records token consumption for a CLI in the forecaster window.
 *
 * @param {string} cli - CLI identifier
 * @param {number} tokens - Estimated tokens consumed
 */
export function recordForecasterConsumption(cli, tokens) {
  rateLimitForecaster.record(cli, tokens);
}

/**
 * Returns a forecast for a CLI and emits RATE_LIMIT_FORECAST_UPDATED.
 *
 * @param {string} cli - CLI identifier
 * @param {number} rateLimitBudget - Total token budget per window
 * @returns {ReturnType<RateLimitForecaster['forecast']>}
 */
export function forecastRateLimit(cli, rateLimitBudget) {
  const result = rateLimitForecaster.forecast(cli, rateLimitBudget);

  eventBus.emitEvent(EVENT_TYPES.RATE_LIMIT_FORECAST_UPDATED, {
    metadata: result,
  });

  return result;
}
