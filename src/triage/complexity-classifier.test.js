import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../config.js', () => ({
  config: {
    complexityTrivialMax: 3,
    complexityStandardMax: 6,
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: {
    emitEvent: vi.fn().mockReturnValue({}),
  },
  EVENT_TYPES: {
    TASK_CLASSIFIED: 'task:classified',
  },
}));

import { classifyComplexity, classifyAndEmit, calculateRealComplexity } from './complexity-classifier.js';
import { eventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

describe('complexity-classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── classifyComplexity ──────────────────────────────────

  describe('classifyComplexity', () => {
    it('classifies a trivial task (low devPoints, few criteria, no plan, short story)', () => {
      const task = {
        taskId: 'trivial-1',
        devPoints: 1,
        acceptanceCriteria: ['one'],
        userStory: { who: 'dev', what: 'fix typo', why: 'clean' },
      };

      const result = classifyComplexity(task);

      expect(result.level).toBe('trivial');
      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.score).toBeLessThanOrEqual(3);
      expect(result.reasoning).toContain('TRIVIAL');
      expect(result.reasoning).toContain('devPoints=1');
    });

    it('classifies a standard task (medium devPoints, some criteria, short story)', () => {
      const task = {
        taskId: 'standard-1',
        devPoints: 3,
        acceptanceCriteria: ['one', 'two', 'three', 'four'],
        userStory: {
          who: 'user',
          what: 'wants to login with email and password',
          why: 'to access the dashboard',
        },
      };

      const result = classifyComplexity(task);

      expect(result.level).toBe('standard');
      expect(result.score).toBeGreaterThanOrEqual(4);
      expect(result.score).toBeLessThanOrEqual(6);
      expect(result.reasoning).toContain('STANDARD');
    });

    it('classifies a complex task (high devPoints, many criteria, has plan, long story)', () => {
      const task = {
        taskId: 'complex-1',
        devPoints: 13,
        acceptanceCriteria: [
          'API endpoint created',
          'Auth middleware applied',
          'Input validation with Zod',
          'Database migration written',
          'Unit tests cover all paths',
          'Integration test for happy path',
          'Error responses follow API spec',
          'Rate limiting configured',
          'Documentation updated',
        ],
        implementationPlan: [
          'Step 1: Create schema',
          'Step 2: Build endpoint',
          'Step 3: Add tests',
        ],
        userStory: {
          who: 'As a platform admin',
          what: 'I want to manage user roles and permissions through a dedicated API with granular access controls, audit logging, and real-time permission propagation across all microservices',
          why: 'so the organization can enforce security policies and comply with SOC2 requirements while maintaining operational flexibility',
        },
      };

      const result = classifyComplexity(task);

      expect(result.level).toBe('complex');
      expect(result.score).toBeGreaterThanOrEqual(7);
      expect(result.score).toBeLessThanOrEqual(10);
      expect(result.reasoning).toContain('COMPLEX');
    });

    it('handles missing fields gracefully (defaults to trivial)', () => {
      const task = { taskId: 'empty-1' };

      const result = classifyComplexity(task);

      expect(result.level).toBe('trivial');
      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.score).toBeLessThanOrEqual(3);
    });

    it('handles string acceptanceCriteria (newline-separated)', () => {
      const task = {
        taskId: 'string-ac',
        devPoints: 5,
        acceptanceCriteria: 'First criterion\nSecond criterion\nThird criterion',
        userStory: 'A moderate user story with some detail about the feature',
      };

      const result = classifyComplexity(task);

      expect(result.level).toBe('standard');
      expect(result.reasoning).toContain('criteria=3');
    });

    it('handles string userStory', () => {
      const task = {
        taskId: 'string-story',
        devPoints: 2,
        acceptanceCriteria: ['one'],
        userStory: 'short story',
      };

      const result = classifyComplexity(task);

      expect(result.reasoning).toContain(`storyLen=${'short story'.length}`);
    });

    it('returns score clamped between 1 and 10', () => {
      const minResult = classifyComplexity({ taskId: 'min' });
      expect(minResult.score).toBeGreaterThanOrEqual(1);
      expect(minResult.score).toBeLessThanOrEqual(10);

      const maxResult = classifyComplexity({
        taskId: 'max',
        devPoints: 13,
        acceptanceCriteria: new Array(12).fill('criterion'),
        implementationPlan: ['step'],
        userStory: 'x'.repeat(700),
      });
      expect(maxResult.score).toBeGreaterThanOrEqual(1);
      expect(maxResult.score).toBeLessThanOrEqual(10);
    });

    it('reasoning string contains all signal details', () => {
      const task = {
        taskId: 'detail-1',
        devPoints: 5,
        acceptanceCriteria: ['a', 'b', 'c'],
        implementationPlan: { steps: ['one'] },
        userStory: { who: 'user', what: 'do something', why: 'reason' },
      };

      const result = classifyComplexity(task);

      expect(result.reasoning).toMatch(/devPoints=5\(\d+\)/);
      expect(result.reasoning).toMatch(/criteria=3\(\d+\)/);
      expect(result.reasoning).toMatch(/plan=yes\(\d+\)/);
      expect(result.reasoning).toMatch(/storyLen=\d+\(\d+\)/);
      expect(result.reasoning).toMatch(/Score \d+\/10/);
    });

    it('object implementationPlan counts as having a plan', () => {
      const task = {
        taskId: 'obj-plan',
        devPoints: 8,
        implementationPlan: { steps: ['a', 'b'] },
      };

      const result = classifyComplexity(task);
      expect(result.reasoning).toContain('plan=yes');
    });

    it('empty implementationPlan does not count as having a plan', () => {
      const withEmpty = classifyComplexity({
        taskId: 'no-plan-1',
        devPoints: 3,
        implementationPlan: '',
      });
      expect(withEmpty.reasoning).toContain('plan=no');

      const withEmptyArray = classifyComplexity({
        taskId: 'no-plan-2',
        devPoints: 3,
        implementationPlan: [],
      });
      expect(withEmptyArray.reasoning).toContain('plan=no');

      const withEmptyObj = classifyComplexity({
        taskId: 'no-plan-3',
        devPoints: 3,
        implementationPlan: {},
      });
      expect(withEmptyObj.reasoning).toContain('plan=no');
    });
  });

  // ── classifyAndEmit ──────────────────────────────────

  describe('classifyAndEmit', () => {
    it('emits TASK_CLASSIFIED event with correct metadata', () => {
      const task = {
        taskId: 'emit-1',
        devPoints: 5,
        acceptanceCriteria: ['a', 'b', 'c'],
        userStory: 'moderate story here',
      };

      const result = classifyAndEmit(task);

      expect(eventBus.emitEvent).toHaveBeenCalledOnce();
      expect(eventBus.emitEvent).toHaveBeenCalledWith('task:classified', {
        metadata: {
          taskId: 'emit-1',
          level: result.level,
          score: result.score,
          reasoning: result.reasoning,
        },
      });
    });

    it('logs the classification result', () => {
      const task = {
        taskId: 'log-1',
        devPoints: 1,
        acceptanceCriteria: [],
        userStory: 'tiny',
      };

      const result = classifyAndEmit(task);

      expect(logger.info).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`[${result.level.toUpperCase()}]`),
        'KOMODO',
      );
    });

    it('returns the same result as classifyComplexity', () => {
      const task = {
        taskId: 'same-1',
        devPoints: 8,
        acceptanceCriteria: ['a', 'b', 'c', 'd', 'e'],
        implementationPlan: ['step 1'],
        userStory: { who: 'admin', what: 'manage users', why: 'security' },
      };

      const directResult = classifyComplexity(task);
      vi.clearAllMocks();
      const emitResult = classifyAndEmit(task);

      expect(emitResult).toEqual(directResult);
    });

    it('handles null taskId gracefully', () => {
      const task = { devPoints: 2 };

      classifyAndEmit(task);

      expect(eventBus.emitEvent).toHaveBeenCalledWith('task:classified', {
        metadata: expect.objectContaining({ taskId: null }),
      });
    });
  });

  // ── calculateRealComplexity ──────────────────────────────────

  describe('calculateRealComplexity', () => {
    it('falls back to devPoints-based scoring when no plan data exists', () => {
      const task = { taskId: 'no-plan', devPoints: 5, acceptanceCriteria: ['a', 'b'] };

      const result = calculateRealComplexity(task);

      expect(result.signals.noPlanData).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.score).toBeLessThanOrEqual(10);
      expect(result.reasoning).toContain('No plan data');
    });

    it('calculates real complexity from architectPlan data', () => {
      const task = {
        taskId: 'with-arch-plan',
        devPoints: 8,
        acceptanceCriteria: ['a', 'b', 'c', 'd', 'e'],
        architectPlan: {
          filesToCreate: [
            { path: 'src/new-module.js', purpose: 'New module' },
            { path: 'src/new-helper.js', purpose: 'Helper' },
          ],
          filesToModify: [
            { path: 'src/existing.js', changes: 'Add import' },
            { path: 'src/config.js', changes: 'Add config key' },
            { path: 'src/index.js', changes: 'Register module' },
          ],
          dependencies: ['zod', 'lodash'],
          dataModelChanges: 'Add new schema for user permissions with roles table',
          apiChanges: 'New POST /api/permissions endpoint with auth middleware',
          implementationOrder: ['Create schema', 'Build endpoint', 'Add tests'],
          risks: ['Breaking change to auth flow', 'Migration risk'],
        },
      };

      const result = calculateRealComplexity(task);

      expect(result.signals.noPlanData).toBeUndefined();
      expect(result.signals.filesAffected).toBe(5);
      expect(result.signals.dependencies).toBe(2);
      expect(result.signals.dataModelChanges).toBe(true);
      expect(result.signals.apiChanges).toBe(true);
      expect(result.signals.risks).toBe(2);
      expect(result.score).toBeGreaterThanOrEqual(5);
      expect(result.reasoning).toContain('Real complexity');
      expect(result.reasoning).toContain('files=5');
    });

    it('uses implementationPlan as fallback when architectPlan is absent', () => {
      const task = {
        taskId: 'with-impl-plan',
        devPoints: 5,
        implementationPlan: {
          filesToCreate: [{ path: 'src/feature.js', purpose: 'Feature' }],
          filesToModify: [{ path: 'src/app.js', changes: 'Import feature' }],
          dependencies: [],
          dataModelChanges: 'None',
          apiChanges: '',
          risks: [],
          steps: ['Step 1', 'Step 2'],
        },
      };

      const result = calculateRealComplexity(task);

      expect(result.signals.noPlanData).toBeUndefined();
      expect(result.signals.filesAffected).toBe(2);
      expect(result.signals.dataModelChanges).toBe(false);
      expect(result.signals.apiChanges).toBe(false);
    });

    it('prefers architectPlan over implementationPlan', () => {
      const task = {
        taskId: 'both-plans',
        devPoints: 8,
        architectPlan: {
          filesToCreate: [{ path: 'a.js' }, { path: 'b.js' }, { path: 'c.js' }],
          filesToModify: [],
          dependencies: ['pkg1'],
          risks: ['risk1'],
        },
        implementationPlan: {
          filesToCreate: [{ path: 'x.js' }],
          filesToModify: [],
          dependencies: [],
          risks: [],
        },
      };

      const result = calculateRealComplexity(task);

      // Should use architectPlan (3 files, 1 dep, 1 risk) not implementationPlan (1 file)
      expect(result.signals.filesAffected).toBe(3);
      expect(result.signals.dependencies).toBe(1);
      expect(result.signals.risks).toBe(1);
    });

    it('handles string risks in implementationPlan', () => {
      const task = {
        taskId: 'string-risks',
        devPoints: 5,
        implementationPlan: {
          filesToCreate: [{ path: 'src/a.js' }],
          filesToModify: [],
          risks: 'Risk 1\nRisk 2\nRisk 3',
        },
      };

      const result = calculateRealComplexity(task);

      expect(result.signals.risks).toBe(3);
    });

    it('scores higher for tasks with many files, deps, and changes', () => {
      const simpleTask = {
        taskId: 'simple',
        devPoints: 3,
        architectPlan: {
          filesToCreate: [{ path: 'a.js' }],
          filesToModify: [],
          dependencies: [],
          risks: [],
        },
      };

      const complexTask = {
        taskId: 'complex',
        devPoints: 13,
        acceptanceCriteria: new Array(10).fill('criterion'),
        architectPlan: {
          filesToCreate: Array.from({ length: 5 }, (_, i) => ({ path: `src/new${i}.js` })),
          filesToModify: Array.from({ length: 8 }, (_, i) => ({ path: `src/mod${i}.js` })),
          dependencies: ['pkg1', 'pkg2', 'pkg3', 'pkg4'],
          dataModelChanges: 'Major schema overhaul with 5 new tables and foreign key constraints across all entities',
          apiChanges: 'New REST API with 10 endpoints, authentication overhaul, rate limiting per endpoint',
          risks: ['Data migration', 'Breaking API changes', 'Performance regression', 'Auth bypass risk'],
        },
      };

      const simpleResult = calculateRealComplexity(simpleTask);
      const complexResult = calculateRealComplexity(complexTask);

      expect(complexResult.score).toBeGreaterThan(simpleResult.score);
    });

    it('returns score clamped between 1 and 10', () => {
      const minResult = calculateRealComplexity({ taskId: 'min' });
      expect(minResult.score).toBeGreaterThanOrEqual(1);
      expect(minResult.score).toBeLessThanOrEqual(10);

      const maxResult = calculateRealComplexity({
        taskId: 'max',
        devPoints: 13,
        acceptanceCriteria: new Array(15).fill('c'),
        architectPlan: {
          filesToCreate: Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.js` })),
          filesToModify: Array.from({ length: 10 }, (_, i) => ({ path: `m${i}.js` })),
          dependencies: ['a', 'b', 'c', 'd', 'e', 'f'],
          dataModelChanges: 'x'.repeat(200),
          apiChanges: 'y'.repeat(200),
          risks: ['r1', 'r2', 'r3', 'r4', 'r5'],
        },
      });
      expect(maxResult.score).toBeGreaterThanOrEqual(1);
      expect(maxResult.score).toBeLessThanOrEqual(10);
    });
  });
});
