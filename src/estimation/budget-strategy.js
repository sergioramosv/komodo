// src/estimation/budget-strategy.js

import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

const AGENT_TAG = 'BUDGET-STRATEGY';

/**
 * Maximum devPoints allowed per recommendation level.
 * Infinity means no restriction; 0 means nothing is allowed (pause).
 */
const MAX_DEV_POINTS = {
  green: Infinity,
  yellow: 5,
  orange: 2,
  red: 0,
};

/**
 * Lightweight models per CLI type (yellow strategy).
 * Prefer Sonnet-tier: fast but capable.
 */
const LIGHTWEIGHT_MODELS = {
  claude: 'sonnet',
  codex: 'o4-mini',
  gemini: 'gemini-2.5-flash',
};

/**
 * Minimum models per CLI type (orange strategy).
 * Prefer Haiku/Flash-tier: cheapest available.
 */
const MINIMUM_MODELS = {
  claude: 'haiku',
  codex: 'codex-mini',
  gemini: 'gemini-2.5-flash',
};

/**
 * Returns the task filtering strategy based on the forecast recommendation.
 *
 * - green  → all tasks allowed, no model override
 * - yellow → devPoints <= 5 + lightweight models
 * - orange → devPoints <= 2 + minimum models
 * - red    → pause execution
 *
 * @param {{ recommendation: 'green'|'yellow'|'orange'|'red' }} forecast
 * @returns {{ recommendation: string, maxDevPoints: number, modelTier: 'lightweight'|'minimum'|null }}
 */
export function selectTaskStrategy(forecast) {
  const rec = forecast?.recommendation || 'green';
  const maxDevPoints = MAX_DEV_POINTS[rec] ?? Infinity;
  const modelTier = rec === 'yellow' ? 'lightweight' : rec === 'orange' ? 'minimum' : null;

  return { recommendation: rec, maxDevPoints, modelTier };
}

/**
 * Returns true if execution should pause because the forecast is red.
 *
 * @param {{ recommendation: string }} forecast
 * @returns {boolean}
 */
export function shouldPauseForForecast(forecast) {
  return forecast?.recommendation === 'red';
}

/**
 * Returns true if the task's devPoints are within the strategy's allowed maximum.
 *
 * @param {{ devPoints?: number }} taskSpec
 * @param {{ maxDevPoints: number }} strategy
 * @returns {boolean}
 */
export function isTaskAllowedByStrategy(taskSpec, strategy) {
  if (strategy.maxDevPoints === Infinity) return true;
  if (strategy.maxDevPoints === 0) return false;
  const devPoints = taskSpec?.devPoints ?? 0;
  return devPoints <= strategy.maxDevPoints;
}

/**
 * Overrides coderModel and reviewerModel based on forecast when not green.
 * Emits BUDGET_STRATEGY_APPLIED event when an override is applied.
 *
 * @param {{ recommendation: string }} forecast
 * @param {{ coderModel: string, reviewerModel: string, cliType: string }} models
 * @returns {{ coderModel: string, reviewerModel: string }}
 */
export function applyForecastModelOverride(forecast, { coderModel, reviewerModel, cliType }) {
  const rec = forecast?.recommendation || 'green';

  if (rec === 'green') {
    return { coderModel, reviewerModel };
  }

  const modelMap = rec === 'yellow' ? LIGHTWEIGHT_MODELS : MINIMUM_MODELS;
  const overrideModel = modelMap[cliType] || coderModel;

  logger.info(
    `Budget strategy override [${rec.toUpperCase()}]: forcing model "${overrideModel}" for CODER and REVIEWER (cliType: ${cliType})`,
    AGENT_TAG,
  );

  eventBus.emitEvent(EVENT_TYPES.BUDGET_STRATEGY_APPLIED, {
    metadata: {
      recommendation: rec,
      originalCoderModel: coderModel,
      originalReviewerModel: reviewerModel,
      overrideModel,
      cliType,
    },
  });

  return { coderModel: overrideModel, reviewerModel: overrideModel };
}
