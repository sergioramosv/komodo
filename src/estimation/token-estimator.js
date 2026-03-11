// src/estimation/token-estimator.js

import { logger } from '../utils/logger.js';

const AGENT_TAG = 'TOKEN_ESTIMATOR';

/**
 * Defines the token estimation tiers based on task complexity (devPoints).
 */
const TOKEN_ESTIMATION_TIERS = {
  TRIVIAL: { minDevPoints: 1, maxDevPoints: 2, estimatedTokens: 8000 },
  STANDARD: { minDevPoints: 3, maxDevPoints: 5, estimatedTokens: 25000 },
  COMPLEX: { minDevPoints: 8, maxDevPoints: 13, estimatedTokens: 60000 },
};

/**
 * Defines the typical token breakdown percentages for different agent roles,
 * based on an observed average task flow. These are initial estimates and
 * can be refined with historical data if/when token usage per agent is tracked.
 */
const AGENT_TOKEN_BREAKDOWN_PERCENTAGES = {
  architect: 0.15, // Initial planning, high-level design
  coder: 0.50,     // Core implementation, significant code generation
  reviewer: 0.20,    // Code review, feedback cycles
  qa: 0.10,        // Testing, verification
  overhead: 0.05,  // General communication, tool usage, etc.
};

/**
 * Estimates the token usage for a given task based on its estimated development points (devPoints).
 * Provides a total estimate and a breakdown per agent role.
 *
 * @param {object} task - The task object.
 * @param {number} task.devPoints - The estimated development points for the task.
 * @returns {object} An object containing the total estimated tokens and a breakdown.
 * {
 *   total: number,
 *   breakdown: {
 *     architect: number,
 *     coder: number,
 *     reviewer: number,
 *     qa: number,
 *     overhead: number
 *   }
 * }
 */
export function estimateTaskTokens(task) {
  const devPoints = task.devPoints;
  let totalEstimatedTokens = 0;

  if (devPoints >= TOKEN_ESTIMATION_TIERS.TRIVIAL.minDevPoints && devPoints <= TOKEN_ESTIMATION_TIERS.TRIVIAL.maxDevPoints) {
    totalEstimatedTokens = TOKEN_ESTIMATION_TIERS.TRIVIAL.estimatedTokens;
  } else if (devPoints >= TOKEN_ESTIMATION_TIERS.STANDARD.minDevPoints && devPoints <= TOKEN_ESTIMATION_TIERS.STANDARD.maxDevPoints) {
    totalEstimatedTokens = TOKEN_ESTIMATION_TIERS.STANDARD.estimatedTokens;
  } else if (devPoints >= TOKEN_ESTIMATION_TIERS.COMPLEX.minDevPoints) { // Assuming devPoints > 13 still fall into complex
    totalEstimatedTokens = TOKEN_ESTIMATION_TIERS.COMPLEX.estimatedTokens;
  } else {
    // Fallback for tasks with devPoints outside defined ranges or invalid
    logger.warn(`Task with devPoints ${devPoints} falls outside standard estimation tiers. Using standard estimate as fallback.`, AGENT_TAG);
    totalEstimatedTokens = TOKEN_ESTIMATION_TIERS.STANDARD.estimatedTokens;
  }

  const breakdown = {};
  for (const agent in AGENT_TOKEN_BREAKDOWN_PERCENTAGES) {
    breakdown[agent] = Math.round(totalEstimatedTokens * AGENT_TOKEN_BREAKDOWN_PERCENTAGES[agent]);
  }

  logger.info(`Estimated ${totalEstimatedTokens} tokens for task (devPoints: ${devPoints}) with breakdown: ${JSON.stringify(breakdown)}`, AGENT_TAG);

  return {
    total: totalEstimatedTokens,
    breakdown: breakdown,
  };
}

/**
 * Placeholder function for fetching current rate limit headroom.
 * In a real scenario, this would query the actual API limits and current usage.
 *
 * @returns {object} { availableTokens: number, resetTime: number (timestamp) }
 */
export async function getRateLimitHeadroom() {
  // TODO: Implement actual call to LLM provider API to get rate limit status.
  // For now, return a high value to allow tasks to proceed during development.
  const MOCK_AVAILABLE_TOKENS = 500000; // Mock a large number of available tokens
  const MOCK_RESET_TIME = Date.now() + (60 * 60 * 1000); // Mock reset in 1 hour

  logger.debug(`Mocking rate limit headroom: ${MOCK_AVAILABLE_TOKENS} available tokens`, AGENT_TAG);

  return {
    availableTokens: MOCK_AVAILABLE_TOKENS,
    resetTime: MOCK_RESET_TIME,
  };
}
