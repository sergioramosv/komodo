// src/estimation/budget-strategy.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  selectTaskStrategy,
  shouldPauseForForecast,
  isTaskAllowedByStrategy,
  applyForecastModelOverride,
} from './budget-strategy.js';

// Mock eventBus to avoid side effects in tests
vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: { BUDGET_STRATEGY_APPLIED: 'budget:strategy:applied' },
}));

// Mock logger to suppress output
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('selectTaskStrategy()', () => {
  it('green → maxDevPoints=Infinity, no modelTier', () => {
    const strategy = selectTaskStrategy({ recommendation: 'green' });
    expect(strategy.recommendation).toBe('green');
    expect(strategy.maxDevPoints).toBe(Infinity);
    expect(strategy.modelTier).toBeNull();
  });

  it('yellow → maxDevPoints=5, modelTier=lightweight', () => {
    const strategy = selectTaskStrategy({ recommendation: 'yellow' });
    expect(strategy.recommendation).toBe('yellow');
    expect(strategy.maxDevPoints).toBe(5);
    expect(strategy.modelTier).toBe('lightweight');
  });

  it('orange → maxDevPoints=2, modelTier=minimum', () => {
    const strategy = selectTaskStrategy({ recommendation: 'orange' });
    expect(strategy.recommendation).toBe('orange');
    expect(strategy.maxDevPoints).toBe(2);
    expect(strategy.modelTier).toBe('minimum');
  });

  it('red → maxDevPoints=0, no modelTier', () => {
    const strategy = selectTaskStrategy({ recommendation: 'red' });
    expect(strategy.recommendation).toBe('red');
    expect(strategy.maxDevPoints).toBe(0);
    expect(strategy.modelTier).toBeNull();
  });

  it('unknown recommendation defaults to green', () => {
    const strategy = selectTaskStrategy({ recommendation: 'unknown' });
    expect(strategy.maxDevPoints).toBe(Infinity);
    expect(strategy.modelTier).toBeNull();
  });

  it('null forecast defaults gracefully', () => {
    const strategy = selectTaskStrategy(null);
    expect(strategy.recommendation).toBe('green');
    expect(strategy.maxDevPoints).toBe(Infinity);
  });
});

describe('shouldPauseForForecast()', () => {
  it('returns true for red', () => {
    expect(shouldPauseForForecast({ recommendation: 'red' })).toBe(true);
  });

  it('returns false for green', () => {
    expect(shouldPauseForForecast({ recommendation: 'green' })).toBe(false);
  });

  it('returns false for yellow', () => {
    expect(shouldPauseForForecast({ recommendation: 'yellow' })).toBe(false);
  });

  it('returns false for orange', () => {
    expect(shouldPauseForForecast({ recommendation: 'orange' })).toBe(false);
  });

  it('returns false for null forecast', () => {
    expect(shouldPauseForForecast(null)).toBe(false);
  });
});

describe('isTaskAllowedByStrategy()', () => {
  it('green strategy allows any task regardless of devPoints', () => {
    const strategy = { maxDevPoints: Infinity };
    expect(isTaskAllowedByStrategy({ devPoints: 100 }, strategy)).toBe(true);
  });

  it('red strategy (maxDevPoints=0) blocks all tasks', () => {
    const strategy = { maxDevPoints: 0 };
    expect(isTaskAllowedByStrategy({ devPoints: 0 }, strategy)).toBe(false);
    expect(isTaskAllowedByStrategy({ devPoints: 1 }, strategy)).toBe(false);
  });

  it('yellow strategy allows tasks with devPoints <= 5', () => {
    const strategy = { maxDevPoints: 5 };
    expect(isTaskAllowedByStrategy({ devPoints: 5 }, strategy)).toBe(true);
    expect(isTaskAllowedByStrategy({ devPoints: 3 }, strategy)).toBe(true);
    expect(isTaskAllowedByStrategy({ devPoints: 6 }, strategy)).toBe(false);
  });

  it('orange strategy allows tasks with devPoints <= 2', () => {
    const strategy = { maxDevPoints: 2 };
    expect(isTaskAllowedByStrategy({ devPoints: 2 }, strategy)).toBe(true);
    expect(isTaskAllowedByStrategy({ devPoints: 1 }, strategy)).toBe(true);
    expect(isTaskAllowedByStrategy({ devPoints: 3 }, strategy)).toBe(false);
  });

  it('treats missing devPoints as 0 (allowed by yellow/orange)', () => {
    const strategy = { maxDevPoints: 2 };
    expect(isTaskAllowedByStrategy({}, strategy)).toBe(true);
    expect(isTaskAllowedByStrategy(null, strategy)).toBe(true);
  });
});

describe('applyForecastModelOverride()', () => {
  const originalModels = { coderModel: 'opus', reviewerModel: 'sonnet', cliType: 'claude' };

  it('green forecast returns original models unchanged', () => {
    const result = applyForecastModelOverride({ recommendation: 'green' }, originalModels);
    expect(result.coderModel).toBe('opus');
    expect(result.reviewerModel).toBe('sonnet');
  });

  it('yellow forecast forces sonnet for claude CLI', () => {
    const result = applyForecastModelOverride({ recommendation: 'yellow' }, originalModels);
    expect(result.coderModel).toBe('sonnet');
    expect(result.reviewerModel).toBe('sonnet');
  });

  it('orange forecast forces haiku for claude CLI', () => {
    const result = applyForecastModelOverride({ recommendation: 'orange' }, originalModels);
    expect(result.coderModel).toBe('haiku');
    expect(result.reviewerModel).toBe('haiku');
  });

  it('yellow forecast forces o4-mini for codex CLI', () => {
    const result = applyForecastModelOverride(
      { recommendation: 'yellow' },
      { coderModel: 'o3', reviewerModel: 'o3', cliType: 'codex' },
    );
    expect(result.coderModel).toBe('o4-mini');
    expect(result.reviewerModel).toBe('o4-mini');
  });

  it('orange forecast forces codex-mini for codex CLI', () => {
    const result = applyForecastModelOverride(
      { recommendation: 'orange' },
      { coderModel: 'o3', reviewerModel: 'o3', cliType: 'codex' },
    );
    expect(result.coderModel).toBe('codex-mini');
    expect(result.reviewerModel).toBe('codex-mini');
  });

  it('yellow forecast forces gemini-2.5-flash for gemini CLI', () => {
    const result = applyForecastModelOverride(
      { recommendation: 'yellow' },
      { coderModel: 'gemini-2.5-pro', reviewerModel: 'gemini-2.5-pro', cliType: 'gemini' },
    );
    expect(result.coderModel).toBe('gemini-2.5-flash');
    expect(result.reviewerModel).toBe('gemini-2.5-flash');
  });

  it('unknown cliType falls back to original coderModel', () => {
    const result = applyForecastModelOverride(
      { recommendation: 'yellow' },
      { coderModel: 'my-model', reviewerModel: 'my-model', cliType: 'unknown-cli' },
    );
    expect(result.coderModel).toBe('my-model');
    expect(result.reviewerModel).toBe('my-model');
  });

  it('emits BUDGET_STRATEGY_APPLIED event for non-green forecasts', async () => {
    const { eventBus } = await import('../events/event-bus.js');
    applyForecastModelOverride({ recommendation: 'yellow' }, originalModels);
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'budget:strategy:applied',
      expect.objectContaining({
        metadata: expect.objectContaining({
          recommendation: 'yellow',
          originalCoderModel: 'opus',
          overrideModel: 'sonnet',
        }),
      }),
    );
  });
});
