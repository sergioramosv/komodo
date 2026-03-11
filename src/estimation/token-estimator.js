// src/estimation/token-estimator.js

import { config } from '../config.js';

/**
 * Estimates the total token consumption for a task based on its devPoints and a detailed breakdown per role.
 *
 * @param {Object} taskSpec
 * @param {number} [taskSpec.devPoints] - Development effort points
 * @returns {{
 *   total: number,
 *   breakdown: {
 *     architect: number,
 *     coder: number,
 *     security: number,
 *     reviewer: number,
 *     overhead: number
 *   }
 * }}
 */
export function estimateTaskTokens(taskSpec) {
  const devPoints = taskSpec.devPoints || 1;
  let estimatedTotalTokens;

  // Determine complexity tier and assign estimated tokens
  if (devPoints <= config.complexityTrivialMax) {
    estimatedTotalTokens = config.tokenEstimates.trivial;
  } else if (devPoints <= config.complexityStandardMax) {
    estimatedTotalTokens = config.tokenEstimates.standard;
  } else {
    estimatedTotalTokens = config.tokenEstimates.complex;
  }

  // Calculate breakdown based on percentages
  const breakdown = {
    architect: Math.round(estimatedTotalTokens * config.tokenBreakdownPercentages.architect),
    coder: Math.round(estimatedTotalTokens * config.tokenBreakdownPercentages.coder),
    security: Math.round(estimatedTotalTokens * config.tokenBreakdownPercentages.security),
    reviewer: Math.round(estimatedTotalTokens * config.tokenBreakdownPercentages.reviewer),
    overhead: Math.round(estimatedTotalTokens * config.tokenBreakdownPercentages.overhead),
  };

  // Adjust total slightly if rounding causes a discrepancy
  const breakdownSum = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
  const total = breakdownSum; // Use the sum of breakdown for the total for consistency

  return {
    total,
    breakdown,
  };
}

// Re-export rate limit functions so consumers can import everything from token-estimator
export { getRateLimitHeadroom, recordTokenConsumption } from './rate-limit-tracker.js';
