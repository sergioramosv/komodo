import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────

const mockTasks = {};

vi.mock('../agents/planner.js', () => ({
  fetchProjectTasks: vi.fn(async (projectId) => mockTasks[projectId] || []),
  filterBlockedTasks: vi.fn((todoTasks, allTasks) => {
    // Simple: all todo tasks are eligible unless blockedBy contains a non-done task
    const taskMap = new Map(allTasks.map(t => [t.id, t]));
    const eligible = [];
    const blocked = [];
    for (const task of todoTasks) {
      if (task.blockedBy?.length) {
        const unresolved = task.blockedBy.filter(id => {
          const blocker = taskMap.get(id);
          return blocker && blocker.status !== 'done';
        });
        if (unresolved.length > 0) {
          blocked.push({ task, unresolvedBlockers: unresolved });
          continue;
        }
      }
      eligible.push(task);
    }
    return { eligible, blocked };
  }),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────

import { selectNextProject, STRATEGIES } from './project-selector.js';

describe('project-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock tasks
    for (const key of Object.keys(mockTasks)) delete mockTasks[key];
  });

  // Helper to set up project tasks
  function setProjectTasks(projectId, tasks) {
    mockTasks[projectId] = tasks;
  }

  function makeTodoTask(id, priority) {
    return { id, status: 'to-do', title: `Task ${id}`, priority };
  }

  function makeDoneTask(id) {
    return { id, status: 'done', title: `Task ${id}` };
  }

  // ── Round-robin strategy ──

  describe('round-robin', () => {
    it('cycles through projects in order', async () => {
      setProjectTasks('proj-A', [makeTodoTask('t1', 5)]);
      setProjectTasks('proj-B', [makeTodoTask('t2', 3)]);
      setProjectTasks('proj-C', [makeTodoTask('t3', 1)]);

      const projects = ['proj-A', 'proj-B', 'proj-C'];
      const context = { lastIndex: -1 };

      const first = await selectNextProject(projects, STRATEGIES.ROUND_ROBIN, context);
      expect(first.projectId).toBe('proj-A');
      expect(context.lastIndex).toBe(0);

      const second = await selectNextProject(projects, STRATEGIES.ROUND_ROBIN, context);
      expect(second.projectId).toBe('proj-B');
      expect(context.lastIndex).toBe(1);

      const third = await selectNextProject(projects, STRATEGIES.ROUND_ROBIN, context);
      expect(third.projectId).toBe('proj-C');
      expect(context.lastIndex).toBe(2);

      // Wraps around
      const fourth = await selectNextProject(projects, STRATEGIES.ROUND_ROBIN, context);
      expect(fourth.projectId).toBe('proj-A');
      expect(context.lastIndex).toBe(0);
    });

    it('skips projects with empty backlogs', async () => {
      setProjectTasks('proj-A', [makeTodoTask('t1', 5)]);
      setProjectTasks('proj-B', []); // empty
      setProjectTasks('proj-C', [makeTodoTask('t3', 1)]);

      const projects = ['proj-A', 'proj-B', 'proj-C'];
      const context = { lastIndex: 0 }; // last was proj-A

      const result = await selectNextProject(projects, STRATEGIES.ROUND_ROBIN, context);
      expect(result.projectId).toBe('proj-C'); // skips proj-B
      expect(context.lastIndex).toBe(2);
    });

    it('returns null when all backlogs are empty', async () => {
      setProjectTasks('proj-A', []);
      setProjectTasks('proj-B', []);

      const projects = ['proj-A', 'proj-B'];
      const context = { lastIndex: -1 };

      const result = await selectNextProject(projects, STRATEGIES.ROUND_ROBIN, context);
      expect(result).toBeNull();
    });
  });

  // ── Priority strategy ──

  describe('priority', () => {
    it('selects project with highest priority (lowest number) task', async () => {
      setProjectTasks('proj-A', [makeTodoTask('t1', 5)]);
      setProjectTasks('proj-B', [makeTodoTask('t2', 1)]); // highest priority
      setProjectTasks('proj-C', [makeTodoTask('t3', 3)]);

      const context = { lastIndex: -1 };
      const result = await selectNextProject(
        ['proj-A', 'proj-B', 'proj-C'],
        STRATEGIES.PRIORITY,
        context,
      );

      expect(result.projectId).toBe('proj-B');
      expect(result.eligible).toBe(1);
    });

    it('uses default priority 999 for tasks without priority', async () => {
      setProjectTasks('proj-A', [makeTodoTask('t1', undefined)]);
      setProjectTasks('proj-B', [makeTodoTask('t2', 10)]);

      const context = { lastIndex: -1 };
      const result = await selectNextProject(
        ['proj-A', 'proj-B'],
        STRATEGIES.PRIORITY,
        context,
      );

      expect(result.projectId).toBe('proj-B');
    });

    it('returns null when all backlogs empty', async () => {
      setProjectTasks('proj-A', []);
      setProjectTasks('proj-B', [makeDoneTask('t1')]);

      const context = { lastIndex: -1 };
      const result = await selectNextProject(
        ['proj-A', 'proj-B'],
        STRATEGIES.PRIORITY,
        context,
      );

      expect(result).toBeNull();
    });
  });

  // ── Backlog-size strategy ──

  describe('backlog-size', () => {
    it('selects project with most eligible tasks', async () => {
      setProjectTasks('proj-A', [makeTodoTask('t1', 5)]);
      setProjectTasks('proj-B', [
        makeTodoTask('t2', 3),
        makeTodoTask('t3', 4),
        makeTodoTask('t4', 2),
      ]);
      setProjectTasks('proj-C', [makeTodoTask('t5', 1), makeTodoTask('t6', 7)]);

      const context = { lastIndex: -1 };
      const result = await selectNextProject(
        ['proj-A', 'proj-B', 'proj-C'],
        STRATEGIES.BACKLOG_SIZE,
        context,
      );

      expect(result.projectId).toBe('proj-B');
      expect(result.eligible).toBe(3);
    });

    it('returns null when all empty', async () => {
      setProjectTasks('proj-A', []);
      setProjectTasks('proj-B', []);

      const context = { lastIndex: -1 };
      const result = await selectNextProject(
        ['proj-A', 'proj-B'],
        STRATEGIES.BACKLOG_SIZE,
        context,
      );

      expect(result).toBeNull();
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('returns null for empty project list', async () => {
      const context = { lastIndex: -1 };
      const result = await selectNextProject([], STRATEGIES.ROUND_ROBIN, context);
      expect(result).toBeNull();
    });

    it('returns null for null project list', async () => {
      const context = { lastIndex: -1 };
      const result = await selectNextProject(null, STRATEGIES.ROUND_ROBIN, context);
      expect(result).toBeNull();
    });

    it('falls back to round-robin for unknown strategy', async () => {
      setProjectTasks('proj-A', [makeTodoTask('t1', 5)]);

      const context = { lastIndex: -1 };
      const result = await selectNextProject(['proj-A'], 'unknown-strategy', context);

      expect(result.projectId).toBe('proj-A');
    });

    it('handles single project', async () => {
      setProjectTasks('proj-A', [makeTodoTask('t1', 5)]);

      const context = { lastIndex: -1 };
      const result = await selectNextProject(['proj-A'], STRATEGIES.ROUND_ROBIN, context);

      expect(result.projectId).toBe('proj-A');
      expect(result.eligible).toBe(1);
    });

    it('skips blocked tasks', async () => {
      setProjectTasks('proj-A', [
        { id: 't1', status: 'to-do', title: 'Task 1', blockedBy: ['t2'] },
        { id: 't2', status: 'in-progress', title: 'Task 2' },
      ]);
      setProjectTasks('proj-B', [makeTodoTask('t3', 1)]);

      const context = { lastIndex: -1 };
      const result = await selectNextProject(
        ['proj-A', 'proj-B'],
        STRATEGIES.ROUND_ROBIN,
        context,
      );

      // proj-A has no eligible tasks (t1 is blocked by in-progress t2)
      expect(result.projectId).toBe('proj-B');
    });
  });
});
