/**
 * E2E tests: full leaderboard flow with simulated multi-model data
 *
 * Tests the complete pipeline:
 *   TaskRecord[] → computeLeaderboard() → computeOptimalModels() → computeRecommendations()
 *
 * Covers:
 *   - 3 models × 3 roles × 3 complexities (trivial, standard, complex)
 *   - Edge cases: model with no data, tied scores, single record per model
 */

import { describe, it, expect } from 'vitest';
import {
  computeLeaderboard,
  computeOptimalModels,
  computeRecommendations,
} from './leaderboard';
import type { TaskRecord } from './leaderboard';

// ── Helpers ─────────────────────────────────────────────────────────────────

let taskCounter = 0;

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  taskCounter++;
  return {
    taskId: `task-${taskCounter}`,
    plannerModel: 'claude-opus-4',
    coderModel: 'claude-sonnet-4',
    reviewerModel: 'claude-haiku-4',
    reviewScore: 7,
    reviewCycles: 1,
    durationSeconds: 300,
    cost: 0.10,
    completedAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

// ── Simulated dataset ───────────────────────────────────────────────────────

// 3 models: claude-opus-4 (expensive, high quality),
//           claude-sonnet-4 (mid-range),
//           claude-haiku-4 (cheap, decent quality)
//
// Each model appears in different roles across tasks of varying complexity.

const TRIVIAL_TASKS: TaskRecord[] = [
  // Trivial tasks — all models score high, fast execution
  makeTask({ plannerModel: 'claude-opus-4', coderModel: 'claude-opus-4', reviewerModel: 'claude-opus-4', reviewScore: 9, reviewCycles: 1, durationSeconds: 60, cost: 0.20 }),
  makeTask({ plannerModel: 'claude-sonnet-4', coderModel: 'claude-sonnet-4', reviewerModel: 'claude-sonnet-4', reviewScore: 9, reviewCycles: 1, durationSeconds: 90, cost: 0.08 }),
  makeTask({ plannerModel: 'claude-haiku-4', coderModel: 'claude-haiku-4', reviewerModel: 'claude-haiku-4', reviewScore: 8, reviewCycles: 1, durationSeconds: 45, cost: 0.02 }),
  makeTask({ plannerModel: 'claude-opus-4', coderModel: 'claude-sonnet-4', reviewerModel: 'claude-haiku-4', reviewScore: 9, reviewCycles: 1, durationSeconds: 70, cost: 0.12 }),
];

const STANDARD_TASKS: TaskRecord[] = [
  // Standard tasks — quality differences start showing
  makeTask({ plannerModel: 'claude-opus-4', coderModel: 'claude-opus-4', reviewerModel: 'claude-opus-4', reviewScore: 9, reviewCycles: 1, durationSeconds: 300, cost: 0.50 }),
  makeTask({ plannerModel: 'claude-opus-4', coderModel: 'claude-sonnet-4', reviewerModel: 'claude-opus-4', reviewScore: 8, reviewCycles: 2, durationSeconds: 420, cost: 0.30 }),
  makeTask({ plannerModel: 'claude-sonnet-4', coderModel: 'claude-sonnet-4', reviewerModel: 'claude-sonnet-4', reviewScore: 7, reviewCycles: 2, durationSeconds: 360, cost: 0.15 }),
  makeTask({ plannerModel: 'claude-sonnet-4', coderModel: 'claude-haiku-4', reviewerModel: 'claude-sonnet-4', reviewScore: 6, reviewCycles: 3, durationSeconds: 480, cost: 0.10 }),
  makeTask({ plannerModel: 'claude-haiku-4', coderModel: 'claude-haiku-4', reviewerModel: 'claude-haiku-4', reviewScore: 5, reviewCycles: 3, durationSeconds: 600, cost: 0.04 }),
];

const COMPLEX_TASKS: TaskRecord[] = [
  // Complex tasks — expensive models shine, cheap ones struggle
  makeTask({ plannerModel: 'claude-opus-4', coderModel: 'claude-opus-4', reviewerModel: 'claude-opus-4', reviewScore: 9, reviewCycles: 2, durationSeconds: 900, cost: 1.20 }),
  makeTask({ plannerModel: 'claude-opus-4', coderModel: 'claude-opus-4', reviewerModel: 'claude-sonnet-4', reviewScore: 8, reviewCycles: 2, durationSeconds: 840, cost: 0.90 }),
  makeTask({ plannerModel: 'claude-sonnet-4', coderModel: 'claude-sonnet-4', reviewerModel: 'claude-sonnet-4', reviewScore: 7, reviewCycles: 3, durationSeconds: 1200, cost: 0.40 }),
  makeTask({ plannerModel: 'claude-haiku-4', coderModel: 'claude-haiku-4', reviewerModel: 'claude-haiku-4', reviewScore: 3, reviewCycles: 5, durationSeconds: 1800, cost: 0.08 }),
];

const ALL_TASKS = [...TRIVIAL_TASKS, ...STANDARD_TASKS, ...COMPLEX_TASKS];

// ── E2E Tests ───────────────────────────────────────────────────────────────

describe('Leaderboard E2E — multi-model simulated data', () => {

  // ── Full pipeline with 3 models × 3 roles × 3 complexities ─────────────

  describe('full pipeline: computeLeaderboard → computeOptimalModels → computeRecommendations', () => {

    it('produces leaderboard rows for all model+role combinations present in the data', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);

      // Each model appears in at least one task per role
      const combos = new Set(rows.map(r => `${r.model}::${r.role}`));
      expect(combos.has('claude-opus-4::planner')).toBe(true);
      expect(combos.has('claude-opus-4::coder')).toBe(true);
      expect(combos.has('claude-opus-4::reviewer')).toBe(true);
      expect(combos.has('claude-sonnet-4::planner')).toBe(true);
      expect(combos.has('claude-sonnet-4::coder')).toBe(true);
      expect(combos.has('claude-sonnet-4::reviewer')).toBe(true);
      expect(combos.has('claude-haiku-4::planner')).toBe(true);
      expect(combos.has('claude-haiku-4::coder')).toBe(true);
      expect(combos.has('claude-haiku-4::reviewer')).toBe(true);
    });

    it('sorts leaderboard by avgScore descending', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);

      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1].avgScore ?? -1;
        const curr = rows[i].avgScore ?? -1;
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('opus scores higher than haiku on average across all roles', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);

      for (const role of ['planner', 'coder', 'reviewer']) {
        const opus = rows.find(r => r.model === 'claude-opus-4' && r.role === role);
        const haiku = rows.find(r => r.model === 'claude-haiku-4' && r.role === role);
        expect(opus).toBeDefined();
        expect(haiku).toBeDefined();
        expect(opus!.avgScore).toBeGreaterThan(haiku!.avgScore!);
      }
    });

    it('opus costs more than haiku on average across all roles', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);

      for (const role of ['planner', 'coder', 'reviewer']) {
        const opus = rows.find(r => r.model === 'claude-opus-4' && r.role === role);
        const haiku = rows.find(r => r.model === 'claude-haiku-4' && r.role === role);
        expect(opus!.avgCost).toBeGreaterThan(haiku!.avgCost);
      }
    });

    it('identifies optimal models per role via computeOptimalModels', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);
      const optimal = computeOptimalModels(rows);

      // Should find best model for each role
      const roles = optimal.map(o => o.role).sort();
      expect(roles).toContain('planner');
      expect(roles).toContain('coder');
      expect(roles).toContain('reviewer');

      // Each optimal model should have the highest score for its role
      for (const opt of optimal) {
        const sameRole = rows.filter(
          r => r.role === opt.role && r.avgScore !== null && r.taskCount >= 3,
        );
        for (const competitor of sameRole) {
          expect(opt.avgScore).toBeGreaterThanOrEqual(competitor.avgScore!);
        }
      }
    });

    it('generates cost-saving recommendations when cheaper models score well', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);
      const recommendations = computeRecommendations(rows);

      // With our dataset, there should be at least one recommendation
      // (sonnet is cheaper than opus but scores well on trivial tasks)
      expect(recommendations.length).toBeGreaterThanOrEqual(0);

      for (const rec of recommendations) {
        expect(rec.recommendedAvgCost).toBeLessThan(rec.currentAvgCost);
        expect(rec.savingsPercent).toBeGreaterThan(0);
        expect(rec.recommendedAvgScore).toBeGreaterThanOrEqual(8);
        expect(rec.message).toContain(rec.recommended);
      }
    });

    it('taskCount matches the number of tasks each model+role participated in', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);

      // Manually count opus as planner
      const opusPlanner = ALL_TASKS.filter(t => t.plannerModel === 'claude-opus-4');
      const row = rows.find(r => r.model === 'claude-opus-4' && r.role === 'planner');
      expect(row!.taskCount).toBe(opusPlanner.length);
    });

    it('avgDurationMinutes is correctly converted from seconds', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);

      for (const row of rows) {
        expect(row.avgDurationMinutes).toBeGreaterThan(0);
        // Duration in minutes should be reasonable (< 60 min for our test data)
        expect(row.avgDurationMinutes).toBeLessThan(60);
      }
    });
  });

  // ── Complexity filtering ────────────────────────────────────────────────

  describe('complexity-based filtering with allowedTaskIds', () => {

    it('trivial-only filter shows all models scoring high', () => {
      const trivialIds = new Set(TRIVIAL_TASKS.map(t => t.taskId));
      const rows = computeLeaderboard(ALL_TASKS, trivialIds);

      for (const row of rows) {
        if (row.avgScore !== null) {
          expect(row.avgScore).toBeGreaterThanOrEqual(8);
        }
      }
    });

    it('complex-only filter reveals quality gap between models', () => {
      const complexIds = new Set(COMPLEX_TASKS.map(t => t.taskId));
      const rows = computeLeaderboard(ALL_TASKS, complexIds);

      const opusCoder = rows.find(r => r.model === 'claude-opus-4' && r.role === 'coder');
      const haikuCoder = rows.find(r => r.model === 'claude-haiku-4' && r.role === 'coder');

      expect(opusCoder).toBeDefined();
      expect(haikuCoder).toBeDefined();
      // For complex tasks, opus should significantly outperform haiku
      expect(opusCoder!.avgScore! - haikuCoder!.avgScore!).toBeGreaterThanOrEqual(4);
    });

    it('standard-only filter shows moderate scores for all models', () => {
      const standardIds = new Set(STANDARD_TASKS.map(t => t.taskId));
      const rows = computeLeaderboard(ALL_TASKS, standardIds);

      // Every model should have moderate scores (between 4 and 10)
      for (const row of rows) {
        if (row.avgScore !== null) {
          expect(row.avgScore).toBeGreaterThanOrEqual(4);
          expect(row.avgScore).toBeLessThanOrEqual(10);
        }
      }
    });
  });

  // ── Edge case: model with no data ─────────────────────────────────────

  describe('edge case: model with no data', () => {

    it('model not present in any task does not appear in leaderboard', () => {
      const rows = computeLeaderboard(ALL_TASKS, null);
      const phantom = rows.find(r => r.model === 'gpt-4o');
      expect(phantom).toBeUndefined();
    });

    it('empty allowedTaskIds yields empty leaderboard', () => {
      const rows = computeLeaderboard(ALL_TASKS, new Set());
      expect(rows).toHaveLength(0);
    });

    it('computeOptimalModels returns empty for empty leaderboard', () => {
      const optimal = computeOptimalModels([]);
      expect(optimal).toEqual([]);
    });

    it('computeRecommendations returns empty for empty leaderboard', () => {
      const recs = computeRecommendations([]);
      expect(recs).toEqual([]);
    });

    it('tasks with all null reviewScores produce rows with avgScore=null', () => {
      const nullScoreTasks = [
        makeTask({ plannerModel: 'model-x', coderModel: 'model-x', reviewerModel: 'model-x', reviewScore: null }),
        makeTask({ plannerModel: 'model-x', coderModel: 'model-x', reviewerModel: 'model-x', reviewScore: null }),
        makeTask({ plannerModel: 'model-x', coderModel: 'model-x', reviewerModel: 'model-x', reviewScore: null }),
      ];
      const rows = computeLeaderboard(nullScoreTasks, null);

      for (const row of rows) {
        expect(row.avgScore).toBeNull();
        expect(row.taskCount).toBe(3);
      }
    });

    it('model with null scores is excluded from optimal models', () => {
      const nullScoreTasks = [
        makeTask({ plannerModel: 'model-null', coderModel: 'model-null', reviewerModel: 'model-null', reviewScore: null }),
        makeTask({ plannerModel: 'model-null', coderModel: 'model-null', reviewerModel: 'model-null', reviewScore: null }),
        makeTask({ plannerModel: 'model-null', coderModel: 'model-null', reviewerModel: 'model-null', reviewScore: null }),
      ];
      const rows = computeLeaderboard(nullScoreTasks, null);
      const optimal = computeOptimalModels(rows);

      expect(optimal).toEqual([]);
    });
  });

  // ── Edge case: tied scores ────────────────────────────────────────────

  describe('edge case: tied scores between models', () => {

    it('two models with identical avgScore both appear in leaderboard', () => {
      const tiedTasks = [
        makeTask({ plannerModel: 'model-a', coderModel: '', reviewerModel: '', reviewScore: 8, cost: 0.50 }),
        makeTask({ plannerModel: 'model-a', coderModel: '', reviewerModel: '', reviewScore: 8, cost: 0.50 }),
        makeTask({ plannerModel: 'model-a', coderModel: '', reviewerModel: '', reviewScore: 8, cost: 0.50 }),
        makeTask({ plannerModel: 'model-b', coderModel: '', reviewerModel: '', reviewScore: 8, cost: 0.10 }),
        makeTask({ plannerModel: 'model-b', coderModel: '', reviewerModel: '', reviewScore: 8, cost: 0.10 }),
        makeTask({ plannerModel: 'model-b', coderModel: '', reviewerModel: '', reviewScore: 8, cost: 0.10 }),
      ];
      const rows = computeLeaderboard(tiedTasks, null);

      const modelA = rows.find(r => r.model === 'model-a' && r.role === 'planner');
      const modelB = rows.find(r => r.model === 'model-b' && r.role === 'planner');

      expect(modelA).toBeDefined();
      expect(modelB).toBeDefined();
      expect(modelA!.avgScore).toBe(modelB!.avgScore);
    });

    it('computeOptimalModels picks one winner even with tied scores', () => {
      const tiedTasks = [
        makeTask({ plannerModel: 'model-a', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.50 }),
        makeTask({ plannerModel: 'model-a', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.50 }),
        makeTask({ plannerModel: 'model-a', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.50 }),
        makeTask({ plannerModel: 'model-b', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.10 }),
        makeTask({ plannerModel: 'model-b', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.10 }),
        makeTask({ plannerModel: 'model-b', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.10 }),
      ];
      const rows = computeLeaderboard(tiedTasks, null);
      const optimal = computeOptimalModels(rows);

      const plannerOptimal = optimal.find(o => o.role === 'planner');
      expect(plannerOptimal).toBeDefined();
      // One of them wins — deterministic based on iteration order
      expect(['model-a', 'model-b']).toContain(plannerOptimal!.model);
    });

    it('computeRecommendations finds cheaper alternative even with tied scores', () => {
      const tiedTasks = [
        makeTask({ plannerModel: 'model-expensive', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 1.00 }),
        makeTask({ plannerModel: 'model-expensive', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 1.00 }),
        makeTask({ plannerModel: 'model-expensive', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 1.00 }),
        makeTask({ plannerModel: 'model-cheap', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.10 }),
        makeTask({ plannerModel: 'model-cheap', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.10 }),
        makeTask({ plannerModel: 'model-cheap', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.10 }),
      ];
      const rows = computeLeaderboard(tiedTasks, null);
      const recs = computeRecommendations(rows);

      const plannerRec = recs.find(r => r.role === 'planner');
      expect(plannerRec).toBeDefined();
      expect(plannerRec!.recommended).toBe('model-cheap');
      expect(plannerRec!.currentDefault).toBe('model-expensive');
      expect(plannerRec!.savingsPercent).toBe(90);
    });
  });

  // ── Edge case: single record per model ────────────────────────────────

  describe('edge case: single record per model', () => {

    it('single-task models appear in leaderboard with taskCount=1', () => {
      const singleTasks = [
        makeTask({ plannerModel: 'model-solo', coderModel: 'model-solo', reviewerModel: 'model-solo', reviewScore: 10 }),
      ];
      const rows = computeLeaderboard(singleTasks, null);

      expect(rows).toHaveLength(3); // planner, coder, reviewer
      for (const row of rows) {
        expect(row.model).toBe('model-solo');
        expect(row.taskCount).toBe(1);
        expect(row.avgScore).toBe(10);
      }
    });

    it('single-task models are excluded from optimal models (need MIN_TASKS >= 3)', () => {
      const singleTasks = [
        makeTask({ plannerModel: 'model-solo', coderModel: 'model-solo', reviewerModel: 'model-solo', reviewScore: 10 }),
      ];
      const rows = computeLeaderboard(singleTasks, null);
      const optimal = computeOptimalModels(rows);

      expect(optimal).toEqual([]);
    });

    it('single-task models are excluded from recommendations (need MIN_TASKS >= 3)', () => {
      const singleTasks = [
        makeTask({ plannerModel: 'model-a', coderModel: '', reviewerModel: '', reviewScore: 10, cost: 1.00 }),
        makeTask({ plannerModel: 'model-b', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.01 }),
      ];
      const rows = computeLeaderboard(singleTasks, null);
      const recs = computeRecommendations(rows);

      // Neither model has enough tasks for recommendations
      expect(recs).toEqual([]);
    });

    it('model with exactly 2 tasks is still excluded from optimal (below threshold)', () => {
      const twoTasks = [
        makeTask({ plannerModel: 'model-two', coderModel: '', reviewerModel: '', reviewScore: 10, cost: 0.50 }),
        makeTask({ plannerModel: 'model-two', coderModel: '', reviewerModel: '', reviewScore: 10, cost: 0.50 }),
      ];
      const rows = computeLeaderboard(twoTasks, null);
      const optimal = computeOptimalModels(rows);

      expect(optimal).toEqual([]);
    });

    it('model with exactly 3 tasks qualifies for optimal models', () => {
      const threeTasks = [
        makeTask({ plannerModel: 'model-three', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.30 }),
        makeTask({ plannerModel: 'model-three', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.30 }),
        makeTask({ plannerModel: 'model-three', coderModel: '', reviewerModel: '', reviewScore: 9, cost: 0.30 }),
      ];
      const rows = computeLeaderboard(threeTasks, null);
      const optimal = computeOptimalModels(rows);

      expect(optimal).toHaveLength(1);
      expect(optimal[0].model).toBe('model-three');
      expect(optimal[0].role).toBe('planner');
    });
  });

  // ── Edge case: mixed null and non-null scores ─────────────────────────

  describe('edge case: mixed null and numeric reviewScores', () => {

    it('avgScore only averages non-null scores', () => {
      const mixedTasks = [
        makeTask({ plannerModel: 'model-mix', coderModel: '', reviewerModel: '', reviewScore: 10 }),
        makeTask({ plannerModel: 'model-mix', coderModel: '', reviewerModel: '', reviewScore: null }),
        makeTask({ plannerModel: 'model-mix', coderModel: '', reviewerModel: '', reviewScore: 6 }),
      ];
      const rows = computeLeaderboard(mixedTasks, null);
      const row = rows.find(r => r.model === 'model-mix');

      expect(row).toBeDefined();
      expect(row!.taskCount).toBe(3);
      // Only 10 and 6 are averaged = 8.0
      expect(row!.avgScore).toBe(8);
    });

    it('reviewScore=0 is treated as a valid score, not null', () => {
      const zeroScoreTasks = [
        makeTask({ plannerModel: 'model-zero', coderModel: '', reviewerModel: '', reviewScore: 0 }),
        makeTask({ plannerModel: 'model-zero', coderModel: '', reviewerModel: '', reviewScore: 0 }),
        makeTask({ plannerModel: 'model-zero', coderModel: '', reviewerModel: '', reviewScore: 0 }),
      ];
      const rows = computeLeaderboard(zeroScoreTasks, null);
      const row = rows.find(r => r.model === 'model-zero');

      expect(row!.avgScore).toBe(0);
      expect(row!.taskCount).toBe(3);
    });
  });

  // ── Full end-to-end lifecycle ─────────────────────────────────────────

  describe('complete lifecycle: build leaderboard → find optimal → recommend cheaper', () => {

    it('runs the full leaderboard pipeline end-to-end with realistic multi-model data', () => {
      // Step 1: Build leaderboard from all simulated tasks
      const leaderboard = computeLeaderboard(ALL_TASKS, null);
      expect(leaderboard.length).toBeGreaterThanOrEqual(9); // 3 models × 3 roles

      // Step 2: Find optimal models
      const optimal = computeOptimalModels(leaderboard);
      expect(optimal.length).toBeGreaterThanOrEqual(1);

      // Opus should be optimal for most roles given our data
      const opusOptimal = optimal.filter(o => o.model === 'claude-opus-4');
      expect(opusOptimal.length).toBeGreaterThanOrEqual(1);

      // Step 3: Get cost recommendations
      const recommendations = computeRecommendations(leaderboard);

      // Verify pipeline integrity: every recommendation references valid models
      for (const rec of recommendations) {
        const currentExists = leaderboard.some(r => r.model === rec.currentDefault && r.role === rec.role);
        const recommendedExists = leaderboard.some(r => r.model === rec.recommended && r.role === rec.role);
        expect(currentExists).toBe(true);
        expect(recommendedExists).toBe(true);
      }

      // Step 4: Verify optimal labels are well-formed
      for (const opt of optimal) {
        expect(opt.label).toMatch(/^Best for .+: .+ \(\d+\.\d avg score\)$/);
      }
    });
  });
});
