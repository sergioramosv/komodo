import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing module under test
vi.mock('../config.js', () => ({
  config: {
    autonomyLevel: 'autonomous',
    minReviewScore: 7,
    guardianMaxDiffLines: 500,
    guardianEnableLargeDiff: true,
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: { AUTONOMY_LEVEL_LOADED: 'AUTONOMY_LEVEL_LOADED' },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { config } from '../config.js';
import { shouldPause, getActiveLevel, AUTONOMY_LEVELS, GATE_STEPS } from './autonomy-engine.js';

const ALL_STEPS = [
  GATE_STEPS.AFTER_PLANNING,
  GATE_STEPS.AFTER_ARCHITECT,
  GATE_STEPS.AFTER_REVIEW,
  GATE_STEPS.BEFORE_MERGE,
];

describe('autonomy-engine', () => {
  beforeEach(() => {
    // Reset the one-time log flag by re-importing fresh state
    // We set autonomyLevel per test
  });

  // ── getActiveLevel ──────────────────────────────────────

  describe('getActiveLevel', () => {
    it('returns configured level when valid', () => {
      config.autonomyLevel = 'supervised';
      expect(getActiveLevel()).toBe('supervised');
    });

    it('defaults to autonomous when level is invalid', () => {
      config.autonomyLevel = 'invalid-level';
      expect(getActiveLevel()).toBe('autonomous');
    });

    it('defaults to autonomous when level is empty', () => {
      config.autonomyLevel = '';
      expect(getActiveLevel()).toBe('autonomous');
    });
  });

  // ── shouldPause — SUPERVISED ────────────────────────────

  describe('shouldPause — supervised', () => {
    beforeEach(() => {
      config.autonomyLevel = 'supervised';
    });

    it.each(ALL_STEPS)('pauses at every gate step: %s', (step) => {
      expect(shouldPause(step)).toBe(true);
    });

    it('pauses regardless of context values', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE, { reviewScore: 10, diffLines: 1 })).toBe(true);
    });
  });

  // ── shouldPause — SEMI_AUTONOMOUS ───────────────────────

  describe('shouldPause — semi-autonomous', () => {
    beforeEach(() => {
      config.autonomyLevel = 'semi-autonomous';
      config.minReviewScore = 7;
    });

    it('pauses at BEFORE_MERGE', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE)).toBe(true);
    });

    it('pauses at AFTER_REVIEW when score is below threshold', () => {
      expect(shouldPause(GATE_STEPS.AFTER_REVIEW, { reviewScore: 5 })).toBe(true);
    });

    it('does NOT pause at AFTER_REVIEW when score meets threshold', () => {
      expect(shouldPause(GATE_STEPS.AFTER_REVIEW, { reviewScore: 8 })).toBe(false);
    });

    it('does NOT pause at AFTER_REVIEW when score is null', () => {
      expect(shouldPause(GATE_STEPS.AFTER_REVIEW, { reviewScore: null })).toBe(false);
    });

    it('does NOT pause at AFTER_PLANNING', () => {
      expect(shouldPause(GATE_STEPS.AFTER_PLANNING)).toBe(false);
    });

    it('does NOT pause at AFTER_ARCHITECT', () => {
      expect(shouldPause(GATE_STEPS.AFTER_ARCHITECT)).toBe(false);
    });
  });

  // ── shouldPause — AUTONOMOUS ────────────────────────────

  describe('shouldPause — autonomous', () => {
    beforeEach(() => {
      config.autonomyLevel = 'autonomous';
    });

    it.each(ALL_STEPS)('never pauses at any gate step: %s', (step) => {
      expect(shouldPause(step)).toBe(false);
    });

    it('never pauses even with bad context values', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE, { reviewScore: 1, diffLines: 99999 })).toBe(false);
    });
  });

  // ── shouldPause — GUARDIAN ──────────────────────────────

  describe('shouldPause — guardian', () => {
    beforeEach(() => {
      config.autonomyLevel = 'guardian';
      config.minReviewScore = 7;
      config.guardianMaxDiffLines = 500;
    });

    it('pauses at BEFORE_MERGE when diffLines exceeds threshold', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE, { diffLines: 600 })).toBe(true);
    });

    it('does NOT pause at BEFORE_MERGE when diffLines is under threshold', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE, { diffLines: 100 })).toBe(false);
    });

    it('pauses at BEFORE_MERGE when reviewScore is below threshold', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE, { reviewScore: 4 })).toBe(true);
    });

    it('does NOT pause at BEFORE_MERGE when reviewScore meets threshold', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE, { reviewScore: 8 })).toBe(false);
    });

    it('pauses at BEFORE_MERGE when both thresholds exceeded', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE, { reviewScore: 3, diffLines: 1000 })).toBe(true);
    });

    it('does NOT pause at BEFORE_MERGE when context is null', () => {
      expect(shouldPause(GATE_STEPS.BEFORE_MERGE)).toBe(false);
    });

    it('does NOT pause at AFTER_PLANNING', () => {
      expect(shouldPause(GATE_STEPS.AFTER_PLANNING)).toBe(false);
    });

    it('does NOT pause at AFTER_ARCHITECT', () => {
      expect(shouldPause(GATE_STEPS.AFTER_ARCHITECT)).toBe(false);
    });

    it('does NOT pause at AFTER_REVIEW', () => {
      expect(shouldPause(GATE_STEPS.AFTER_REVIEW, { reviewScore: 3 })).toBe(false);
    });
  });
});
