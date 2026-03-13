// src/estimation/token-estimator.js

import { config } from '../config.js';

// Define token estimates for different complexity levels
const COMPLEXITY_TOKEN_ESTIMATES = {
  trivial: 8000,
  standard: 25000,
  complex: 60000,
};

// Define a simple percentage breakdown for each phase
const PHASE_TOKEN_PERCENTAGES = {
  architect: 0.15, // 15%
  coder: 0.50,     // 50%
  security: 0.05,  // 5%
  reviewer: 0.20,  // 20%
  overhead: 0.10,  // 10%
};


/**
 * Estimates the total token consumption for a task based on its complexity level or devPoints.
 *
 * @param {Object} taskSpec
 * @param {number} [taskSpec.devPoints] - Development effort points
 * @param {string} [complexityLevel] - 'trivial', 'standard', 'complex'
 * @returns {{ total: number, breakdown: { architect: number, coder: number, security: number, reviewer: number, overhead: number } }}
 */
export function estimateTaskTokens(taskSpec, complexityLevel) {
  let totalTokens = 0;

  if (complexityLevel && COMPLEXITY_TOKEN_ESTIMATES[complexityLevel]) {
    totalTokens = COMPLEXITY_TOKEN_ESTIMATES[complexityLevel];
  } else {
    // Fallback to devPoints-based estimation if complexityLevel is not provided or invalid
    const devPoints = taskSpec.devPoints || 1;
    // Using a more dynamic scale rather than a fixed MIN_TOKENS, scaling with devPoints
    totalTokens = devPoints * (COMPLEXITY_TOKEN_ESTIMATES.trivial / 2); // Example: 4k tokens per devPoint for fallback
    totalTokens = Math.max(totalTokens, COMPLEXITY_TOKEN_ESTIMATES.trivial); // Ensure minimum trivial tokens
  }

  const breakdown = {};
  let currentTotalFromBreakdown = 0;

  for (const phase in PHASE_TOKEN_PERCENTAGES) {
    const percentage = PHASE_TOKEN_PERCENTAGES[phase];
    breakdown[phase] = Math.round(totalTokens * percentage);
    currentTotalFromBreakdown += breakdown[phase];
  }

  // Adjust for any rounding errors by adding the difference to overhead
  breakdown.overhead += (totalTokens - currentTotalFromBreakdown);


  return {
    total: totalTokens,
    breakdown: breakdown,
  };
}

/**
 * Estimates task tokens calibrated with historical multipliers.
 * Applies the multiplier for the given complexity level to the base estimate.
 * Falls back to the uncalibrated estimate if historicalMultipliers is null/undefined.
 *
 * @param {Object} taskSpec
 * @param {string|null} [complexityLevel] - 'trivial', 'standard', 'complex'
 * @param {{ trivial: number, standard: number, complex: number }|null} [historicalMultipliers]
 * @returns {{ total: number, breakdown: { architect: number, coder: number, security: number, reviewer: number, overhead: number }, multiplierApplied: number }}
 */
export function estimateTaskTokensCalibrated(taskSpec, complexityLevel, historicalMultipliers) {
  const base = estimateTaskTokens(taskSpec, complexityLevel);

  const level = complexityLevel && COMPLEXITY_TOKEN_ESTIMATES[complexityLevel] ? complexityLevel : null;
  let multiplier = 1.0;
  if (historicalMultipliers) {
    if (level && historicalMultipliers[level] != null) {
      multiplier = historicalMultipliers[level];
    } else if (!level) {
      // Pre-classification fallback: average all historical multipliers
      const values = Object.values(historicalMultipliers).filter(v => typeof v === 'number');
      if (values.length > 0) {
        multiplier = values.reduce((sum, v) => sum + v, 0) / values.length;
      }
    }
  }

  if (multiplier === 1.0) {
    return { ...base, multiplierApplied: 1.0 };
  }

  const total = Math.round(base.total * multiplier);
  const breakdown = {};
  for (const phase of Object.keys(base.breakdown)) {
    breakdown[phase] = Math.round(base.breakdown[phase] * multiplier);
  }

  return { total, breakdown, multiplierApplied: multiplier };
}

// Re-export rate limit functions so consumers can import everything from token-estimator
export { getRateLimitHeadroom, recordTokenConsumption } from './rate-limit-tracker.js';
export { rateLimitForecaster, recordForecasterConsumption, forecastRateLimit } from './rate-limit-forecaster.js';

