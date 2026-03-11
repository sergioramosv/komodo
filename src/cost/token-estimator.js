import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { getTaskMetrics, calculateEstimationRatios } from '../estimation/estimation-tracker.js';

const AGENT = 'TOKEN_ESTIMATOR';

/** Base token estimates by complexity level (in thousands) */
const BASE_TOKEN_K = {
  trivial: 8,
  standard: 25,
  complex: 60,
};

/** Baseline files changed per complexity for historical calibration */
const BASELINE_FILES_BY_LEVEL = {
  trivial: 3,
  standard: 8,
  complex: 15,
};

/** Token distribution across agent phases */
const TOKEN_DISTRIBUTION = {
  architect: 0.15,
  coder: 0.50,
  security: 0.05,
  reviewer: 0.20,
  overhead: 0.10,
};

// ─── Sliding window token tracker ────────────────────────────────────────────

let _windowStart = Date.now();
let _windowUsed = 0;

function _resetWindowIfExpired() {
  const windowMs = config.tokenWindowMs || 60_000;
  if (Date.now() - _windowStart >= windowMs) {
    _windowStart = Date.now();
    _windowUsed = 0;
    logger.info('Token rate limit window reset', AGENT);
  }
}

/**
 * Records token usage in the current sliding window.
 * Call this after a task completes with the actual or estimated token count.
 *
 * @param {number} tokens
 */
export function trackTokensUsed(tokens) {
  _resetWindowIfExpired();
  _windowUsed += tokens;
  logger.info(`Token window: ${_windowUsed.toLocaleString()} used in current window`, AGENT);
}

/**
 * Returns current window usage stats.
 *
 * @returns {{ used: number, windowStart: number }}
 */
export function getWindowUsed() {
  _resetWindowIfExpired();
  return { used: _windowUsed, windowStart: _windowStart };
}

// ─── Formula-based estimation ─────────────────────────────────────────────────

/**
 * Computes the formula-based token estimate for a complexity level.
 * This is the fast, synchronous fallback when no historical data is available.
 *
 * @param {'trivial'|'standard'|'complex'} complexityLevel
 * @returns {number} Estimated tokens
 */
export function estimateTokensFormula(complexityLevel) {
  return (BASE_TOKEN_K[complexityLevel] || BASE_TOKEN_K.standard) * 1000;
}

// ─── Main estimation function ─────────────────────────────────────────────────

/**
 * Estimates token usage for a task using historical data (if available)
 * with formula-based fallback.
 *
 * Historical calibration adjusts the base estimate using the ratio of
 * actual avg files changed vs baseline — more files changed historically
 * implies higher token consumption.
 *
 * @param {Object} task - Task specification
 * @param {string} task.complexityLevel - 'trivial' | 'standard' | 'complex'
 * @param {string} [task.taskId]
 * @param {Object} [options]
 * @param {string} [options.projectId] - Project ID for historical calibration
 * @returns {Promise<{
 *   estimatedTokens: number,
 *   breakdown: { architect: number, coder: number, security: number, reviewer: number, overhead: number },
 *   complexityLevel: string,
 *   source: 'historical'|'formula'
 * }>}
 */
export async function estimateTokens(task, { projectId } = {}) {
  const complexityLevel = task.complexityLevel || 'standard';
  let estimatedTokens = estimateTokensFormula(complexityLevel);
  let source = 'formula';

  // ── Historical calibration ──────────────────────────────────────────────
  if (projectId && config.estimationTracking) {
    try {
      const metrics = await getTaskMetrics(projectId);
      if (metrics.length >= 3) {
        const ratios = calculateEstimationRatios(metrics);
        const rangeStats = ratios[complexityLevel];
        if (rangeStats && rangeStats.taskCount >= 3) {
          const baseline = BASELINE_FILES_BY_LEVEL[complexityLevel];
          const actual = rangeStats.avgFilesChanged;
          if (actual > 0 && baseline > 0) {
            const fileRatio = actual / baseline;
            // Clamp adjustment between 0.5x and 2.0x base estimate
            const adjustment = Math.min(Math.max(fileRatio, 0.5), 2.0);
            estimatedTokens = Math.round(estimatedTokens * adjustment);
            source = 'historical';
          }
        }
      }
    } catch (err) {
      logger.warn(`Historical calibration failed, using formula: ${err.message}`, AGENT);
    }
  }

  // ── Compute breakdown ───────────────────────────────────────────────────
  const breakdown = {
    architect: Math.round(estimatedTokens * TOKEN_DISTRIBUTION.architect),
    coder: Math.round(estimatedTokens * TOKEN_DISTRIBUTION.coder),
    security: Math.round(estimatedTokens * TOKEN_DISTRIBUTION.security),
    reviewer: Math.round(estimatedTokens * TOKEN_DISTRIBUTION.reviewer),
    overhead: Math.round(estimatedTokens * TOKEN_DISTRIBUTION.overhead),
  };

  // Fix rounding drift (adjust coder to absorb remainder)
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (total !== estimatedTokens) {
    breakdown.coder += estimatedTokens - total;
  }

  // ── Log breakdown ───────────────────────────────────────────────────────
  logger.info(
    `Token estimate [${complexityLevel}][${source}]: ${estimatedTokens.toLocaleString()} tokens | ` +
    `arch=${breakdown.architect} coder=${breakdown.coder} sec=${breakdown.security} ` +
    `rev=${breakdown.reviewer} overhead=${breakdown.overhead}`,
    AGENT,
  );

  // ── Emit event for dashboard ────────────────────────────────────────────
  eventBus.emitEvent(EVENT_TYPES.TOKEN_ESTIMATED, {
    metadata: {
      taskId: task.taskId || null,
      complexityLevel,
      estimatedTokens,
      breakdown,
      source,
    },
  });

  return { estimatedTokens, breakdown, complexityLevel, source };
}

// ─── Rate limit headroom ──────────────────────────────────────────────────────

/**
 * Checks if there is sufficient token headroom before starting a task.
 *
 * Headroom is sufficient when:
 *   available_tokens >= threshold * estimatedTokens
 *
 * where threshold defaults to 0.8 (80%).
 *
 * @param {number} estimatedTokens
 * @returns {{ hasHeadroom: boolean, available: number, windowSize: number, used: number }}
 */
export function checkRateLimitHeadroom(estimatedTokens) {
  if (!config.tokenLimitEnabled) {
    return { hasHeadroom: true, available: Infinity, windowSize: Infinity, used: 0 };
  }

  _resetWindowIfExpired();

  const windowSize = (config.tokenWindowSizeK || 100) * 1000;
  const available = Math.max(0, windowSize - _windowUsed);
  const threshold = config.tokenHeadroomThreshold || 0.8;
  const hasHeadroom = available >= estimatedTokens * threshold;

  return { hasHeadroom, available, windowSize, used: _windowUsed };
}

/**
 * Waits for sufficient token headroom before starting a task.
 * If headroom is insufficient (< 80% of estimated tokens), emits
 * RATE_LIMIT_PREEMPTIVE_WAIT and waits for the current window to reset.
 *
 * @param {number} estimatedTokens
 * @param {Object} [options]
 * @param {string} [options.taskId]
 * @returns {Promise<void>}
 */
export async function waitForRateLimitHeadroom(estimatedTokens, { taskId } = {}) {
  const { hasHeadroom, available } = checkRateLimitHeadroom(estimatedTokens);
  if (hasHeadroom) return;

  const windowMs = config.tokenWindowMs || 60_000;
  const elapsed = Date.now() - _windowStart;
  const waitMs = Math.max(0, windowMs - elapsed);

  const thresholdPct = Math.round((config.tokenHeadroomThreshold || 0.8) * 100);
  logger.warn(
    `Rate limit preemptive wait: need ${estimatedTokens.toLocaleString()} tokens ` +
    `(${thresholdPct}% headroom required, only ${available.toLocaleString()} available). ` +
    `Waiting ${Math.ceil(waitMs / 1000)}s for window reset...`,
    AGENT,
  );

  eventBus.emitEvent(EVENT_TYPES.RATE_LIMIT_PREEMPTIVE_WAIT, {
    metadata: {
      estimatedTokens,
      available,
      waitMs,
      taskId: taskId || null,
    },
  });

  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  // Reset window after wait
  _windowStart = Date.now();
  _windowUsed = 0;
  logger.info('Token rate limit window reset after preemptive wait', AGENT);
}

// ─── Efficiency scoring ───────────────────────────────────────────────────────

/**
 * Computes the efficiency score for a task: bizPoints / estimatedTokens.
 * Higher score = more business value per token consumed.
 *
 * Uses formula-based estimation (no async I/O) for fast queue sorting.
 *
 * @param {Object} task
 * @param {number} [task.bizPoints]
 * @param {string} [task.complexityLevel]
 * @returns {number} Efficiency score (bizPoints per token)
 */
export function getEfficiencyScore(task) {
  const complexityLevel = task.complexityLevel || 'standard';
  const tokens = estimateTokensFormula(complexityLevel);
  const bizPoints = task.bizPoints || 1;
  return bizPoints / tokens;
}
