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

import { classifyComplexity, classifyAndEmit } from './complexity-classifier.js';
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
});
