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

// Re-export rate limit functions so consumers can import everything from token-estimator
export { getRateLimitHeadroom, recordTokenConsumption } from './rate-limit-tracker.js';
