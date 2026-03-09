import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────

let mockRunTaskResults = [];
let mockRunTaskCallIndex = 0;

vi.mock('../cycle/task-runner.js', () => ({
  runTask: vi.fn(async (projectId) => {
    if (mockRunTaskCallIndex < mockRunTaskResults.length) {
      const result = mockRunTaskResults[mockRunTaskCallIndex++];
      return typeof result === 'function' ? result(projectId) : result;
    }
    return { taskId: null, success: false };
  }),
}));

vi.mock('../config.js', () => ({
  config: {
    autoMerge: true,
    maxReviewCycles: 5,
    projects: [],
    multiProjectStrategy: 'round-robin',
    apiServerEnabled: false,
    defaultUserId: 'user-1',
    dailyBudgetUsd: 10,
    weeklyBudgetUsd: 50,
    budgetWarningThreshold: 0.8,
    estimatedCostPerInvocation: 0.05,
  },
  validateConfig: vi.fn(() => []),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    taskHeader: vi.fn(),
  },
}));

vi.mock('../events/event-bus.js', async () => {
  const { EventEmitter } = await import('events');
  const bus = new EventEmitter();
  bus.emitEvent = vi.fn((type, data) => {
    const payload = { type, timestamp: new Date().toISOString(), metadata: data?.metadata || {} };
    bus.emit(type, payload);
    return payload;
  });
  bus._anyListeners = [];
  bus.onAny = vi.fn();
  return {
    eventBus: bus,
    EVENT_TYPES: {
      AGENT_STATE_CHANGE: 'agent:state-change',
      EXECUTION_STATE_CHANGE: 'execution:state-change',
      BUDGET_UPDATED: 'budget:updated',
      BUDGET_WARNING: 'budget:warning',
      BUDGET_EXCEEDED: 'budget:exceeded',
      BUDGET_RESET: 'budget:reset',
      COST_UPDATED: 'cost:updated',
    },
  };
});

vi.mock('../state/komodo-state.js', () => {
  const state = {
    phase: 'idle',
    executionState: 'stopped',
    currentTask: null,
    currentPR: null,
    reviewCycle: 0,
    tasksCompleted: 0,
    multiProject: null,
    budget: { dailySpent: 0, weeklySpent: 0, dailyBudget: 0, weeklyBudget: 0, paused: false },
    updatePhase: vi.fn((phase, meta = {}) => {
      state.phase = phase;
      if (meta.tasksCompleted !== undefined) state.tasksCompleted = meta.tasksCompleted;
    }),
    setExecutionState: vi.fn((s) => { state.executionState = s; }),
    isStopRequested: vi.fn(() => state.executionState === 'stopped'),
    isPauseRequested: vi.fn(() => state.executionState === 'paused'),
  };
  return {
    komodoState: state,
    PHASES: { IDLE: 'idle', PLANNING: 'planning', CODING: 'coding', REVIEWING: 'reviewing', MERGING: 'merging' },
    EXECUTION_STATES: {
      STOPPED: 'stopped', RUNNING: 'running', PAUSED: 'paused',
      DAEMON_IDLE: 'daemon:idle', DAEMON_RUNNING: 'daemon:running',
      BUDGET_PAUSED: 'budget:paused',
    },
  };
});

vi.mock('../server/ws-server.js', () => ({
  KomodoWsServer: class {
    start() {}
    stop() {}
  },
}));

vi.mock('../server/api-server.js', () => ({
  KomodoApiServer: class {
    start() {}
    stop() {}
  },
}));

vi.mock('../state/checkpoint-manager.js', () => ({
  checkpointManager: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../shutdown/shutdown-manager.js', () => ({
  shutdownManager: { register: vi.fn(), unregister: vi.fn() },
}));

vi.mock('../cost/budget-manager.js', () => ({
  budgetManager: { start: vi.fn(), stop: vi.fn() },
}));

// Mock the project selector to control which project is selected
let mockSelectResults = [];
let mockSelectCallIndex = 0;

vi.mock('./project-selector.js', () => ({
  selectNextProject: vi.fn(async () => {
    if (mockSelectCallIndex < mockSelectResults.length) {
      return mockSelectResults[mockSelectCallIndex++];
    }
    return null;
  }),
  STRATEGIES: {
    ROUND_ROBIN: 'round-robin',
    PRIORITY: 'priority',
    BACKLOG_SIZE: 'backlog-size',
  },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: vi.fn(async (path) => {
    if (path === 'projects') {
      return [
        { id: 'proj-A', members: { 'user-1': { role: 'owner' } } },
        { id: 'proj-B', members: { 'user-1': { role: 'dev' } } },
        { id: 'proj-C', members: { 'user-2': { role: 'owner' } } },
      ];
    }
    return [];
  }),
}));

// ── Tests ──────────────────────────────────────────────────────────

import { runMultiProject, resolveProjectIds, MULTI_PROJECT_EVENTS } from './multi-project-runner.js';
import { komodoState } from '../state/komodo-state.js';
import { config, validateConfig } from '../config.js';
import { eventBus } from '../events/event-bus.js';

describe('multi-project-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTaskResults = [];
    mockRunTaskCallIndex = 0;
    mockSelectResults = [];
    mockSelectCallIndex = 0;
    komodoState.executionState = 'stopped';
    komodoState.multiProject = null;
    // Override isStopRequested to check for 'stopped' only after running
    komodoState.isStopRequested.mockImplementation(() => false);
    komodoState.isPauseRequested.mockImplementation(() => false);
  });

  describe('resolveProjectIds', () => {
    it('returns explicit project IDs from config', async () => {
      config.projects = ['proj-A', 'proj-B'];
      const result = await resolveProjectIds();
      expect(result).toEqual(['proj-A', 'proj-B']);
    });

    it('resolves * to user projects', async () => {
      config.projects = ['*'];
      config.defaultUserId = 'user-1';

      const result = await resolveProjectIds();
      expect(result).toEqual(['proj-A', 'proj-B']);
      // proj-C is excluded because user-1 is not a member
    });

    it('throws if * used without DEFAULT_USER_ID', async () => {
      config.projects = ['*'];
      config.defaultUserId = '';

      await expect(resolveProjectIds()).rejects.toThrow('PROJECTS=* requires DEFAULT_USER_ID');
    });
  });

  describe('runMultiProject', () => {
    it('executes tasks across multiple projects using round-robin', async () => {
      const projects = ['proj-A', 'proj-B', 'proj-C'];

      // Selector returns proj-A, then proj-B, then null (all empty)
      mockSelectResults = [
        { projectId: 'proj-A', eligible: 2 },
        { projectId: 'proj-B', eligible: 1 },
        null, null,
      ];

      // runTask returns success for both
      mockRunTaskResults = [
        { taskId: 't1', taskTitle: 'Task 1', success: true },
        { taskId: 't2', taskTitle: 'Task 2', success: true },
      ];

      const result = await runMultiProject(projects, { tasks: 2 });

      expect(result.tasksCompleted).toBe(2);
      expect(result.tasksFailed).toBe(0);
      expect(result.perProject['proj-A'].tasksCompleted).toBe(1);
      expect(result.perProject['proj-B'].tasksCompleted).toBe(1);
      expect(result.perProject['proj-C'].tasksCompleted).toBe(0);
    });

    it('handles task failures per project', async () => {
      const projects = ['proj-A', 'proj-B'];

      mockSelectResults = [
        { projectId: 'proj-A', eligible: 1 },
      ];

      mockRunTaskResults = [
        { taskId: 't1', taskTitle: 'Task 1', success: false, error: 'compilation failed' },
      ];

      const result = await runMultiProject(projects, { tasks: 1 });

      expect(result.tasksCompleted).toBe(0);
      expect(result.tasksFailed).toBe(1);
      expect(result.perProject['proj-A'].tasksFailed).toBe(1);
    });

    it('stops when all backlogs are empty', async () => {
      const projects = ['proj-A', 'proj-B'];

      // All selections return null
      mockSelectResults = [null, null];

      const result = await runMultiProject(projects, { tasks: 0 }); // continuous

      expect(result.tasksCompleted).toBe(0);
      expect(eventBus.emitEvent).toHaveBeenCalledWith(
        MULTI_PROJECT_EVENTS.ALL_BACKLOGS_EMPTY,
        expect.any(Object),
      );
    });

    it('returns error for invalid strategy', async () => {
      const result = await runMultiProject(['proj-A'], { strategy: 'invalid' });
      expect(result.tasksCompleted).toBe(0);
      expect(result.tasksFailed).toBe(0);
    });

    it('returns early on config validation errors', async () => {
      validateConfig.mockReturnValueOnce(['Missing GOOGLE_APPLICATION_CREDENTIALS']);

      const result = await runMultiProject(['proj-A'], { tasks: 1 });
      expect(result.tasksCompleted).toBe(0);
    });

    it('emits multi-project events', async () => {
      const projects = ['proj-A', 'proj-B'];

      mockSelectResults = [
        { projectId: 'proj-A', eligible: 1 },
        null, null,
      ];
      mockRunTaskResults = [
        { taskId: 't1', taskTitle: 'Task 1', success: true },
      ];

      await runMultiProject(projects, { tasks: 1 });

      const emittedTypes = eventBus.emitEvent.mock.calls.map(c => c[0]);
      expect(emittedTypes).toContain(MULTI_PROJECT_EVENTS.MULTI_RUN_STARTED);
      expect(emittedTypes).toContain(MULTI_PROJECT_EVENTS.PROJECT_SELECTED);
      expect(emittedTypes).toContain(MULTI_PROJECT_EVENTS.MULTI_RUN_COMPLETED);
    });

    it('initializes multiProject state on komodoState', async () => {
      const projects = ['proj-A', 'proj-B'];

      mockSelectResults = [null, null];

      await runMultiProject(projects, { tasks: 0 });

      expect(komodoState.multiProject).not.toBeNull();
      expect(komodoState.multiProject.enabled).toBe(true);
      expect(komodoState.multiProject.projects).toEqual(projects);
      expect(komodoState.multiProject.perProject).toHaveProperty('proj-A');
      expect(komodoState.multiProject.perProject).toHaveProperty('proj-B');
    });

    it('tracks active project in state', async () => {
      const projects = ['proj-A', 'proj-B'];

      mockSelectResults = [
        { projectId: 'proj-B', eligible: 1 },
        null, null,
      ];
      mockRunTaskResults = [
        { taskId: 't1', taskTitle: 'Task 1', success: true },
      ];

      await runMultiProject(projects, { tasks: 1 });

      expect(komodoState.multiProject.activeProject).toBe('proj-B');
    });

    it('handles runTask throwing an exception', async () => {
      const projects = ['proj-A'];

      mockSelectResults = [
        { projectId: 'proj-A', eligible: 1 },
      ];

      // Make runTask throw
      const { runTask } = await import('../cycle/task-runner.js');
      runTask.mockRejectedValueOnce(new Error('Agent crashed'));
      mockRunTaskCallIndex = 999; // Prevent fallback

      const result = await runMultiProject(projects, { tasks: 1 });

      expect(result.tasksFailed).toBe(1);
      expect(result.perProject['proj-A'].tasksFailed).toBe(1);
    });
  });
});
