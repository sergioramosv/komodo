// src/estimation/token-estimator.js

import { config } from '../config.js';

/**
 * Base token estimates per devPoint range.
 * These are rough approximations since CLI agents don't expose actual token usage.
 */
const BASE_TOKENS_PER_DEV_POINT = 15000;
const MIN_TOKENS = 5000;

/**
 * Estimates the total token consumption for a task based on its devPoints.
 *
 * @param {Object} taskSpec
 * @param {number} [taskSpec.devPoints] - Development effort points
 * @returns {{ total: number, breakdown: { base: number, devPoints: number } }}
 */
export function estimateTaskTokens(taskSpec) {
  const devPoints = taskSpec.devPoints || 1;
  const base = MIN_TOKENS;
  const devPointTokens = devPoints * BASE_TOKENS_PER_DEV_POINT;
  const total = base + devPointTokens;

  return {
    total,
    breakdown: { base, devPoints: devPointTokens },
  };
}

// Re-export rate limit functions so consumers can import everything from token-estimator
export { getRateLimitHeadroom, recordTokenConsumption } from './rate-limit-tracker.js';
