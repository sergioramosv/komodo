import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    defaultProjectId: 'test-project-id',
  },
}));

vi.mock('../state/komodo-state.js', () => {
  const state = {
    getSnapshot: vi.fn(),
  };
  return {
    komodoState: state,
    PHASES: { IDLE: 'idle', PLANNING: 'planning', CODING: 'coding', REVIEWING: 'reviewing', MERGING: 'merging' },
    EXECUTION_STATES: { STOPPED: 'stopped', RUNNING: 'running', PAUSED: 'paused' },
  };
});

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  getAll: vi.fn(),
  getById: vi.fn(),
}));

const { komodoState } = await import('../state/komodo-state.js');
const { getAll } = await import('../../skills/planning-task-mcp/src/firebase.js');
const { getStatus, getTasks, getBacklog } = await import('./data.js');

describe('getStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns idle status when nothing is running', () => {
    komodoState.getSnapshot.mockReturnValue({
      executionState: 'stopped',
      phase: 'idle',
      agents: {
        PLANNER: { status: 'idle', startedAt: null },
        CODER: { status: 'idle', startedAt: null },
        REVIEWER: { status: 'idle', startedAt: null },
      },
      taskDetails: null,
      currentPR: null,
      reviewCycle: 0,
      tasksCompleted: 0,
      totalTasks: 0,
    });

    const status = getStatus();
    expect(status.executionState).toBe('stopped');
    expect(status.phase).toBe('idle');
    expect(status.activeAgent).toBeNull();
    expect(status.currentTask).toBeNull();
    expect(status.elapsedMs).toBeNull();
  });

  it('returns active agent and task details when running', () => {
    const now = Date.now();
    komodoState.getSnapshot.mockReturnValue({
      executionState: 'running',
      phase: 'coding',
      agents: {
        PLANNER: { status: 'idle', startedAt: null },
        CODER: { status: 'working', startedAt: new Date(now - 60000).toISOString() },
        REVIEWER: { status: 'idle', startedAt: null },
      },
      taskDetails: { id: 'task-1', title: 'Add login', devPoints: 5 },
      currentPR: 42,
      reviewCycle: 0,
      tasksCompleted: 2,
      totalTasks: 5,
    });

    const status = getStatus();
    expect(status.executionState).toBe('running');
    expect(status.phase).toBe('coding');
    expect(status.activeAgent).toEqual({ name: 'CODER', status: 'working' });
    expect(status.currentTask.title).toBe('Add login');
    expect(status.currentPR).toBe(42);
    expect(status.elapsedMs).toBeGreaterThan(50000);
    expect(status.tasksCompleted).toBe(2);
    expect(status.totalTasks).toBe(5);
  });
});

describe('getTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns to-do tasks sorted by priority', async () => {
    getAll.mockResolvedValue([
      { id: '1', projectId: 'test-project-id', title: 'Low', status: 'to-do', devPoints: 5, bizPoints: 5, priority: 1 },
      { id: '2', projectId: 'test-project-id', title: 'High', status: 'to-do', devPoints: 3, bizPoints: 13, priority: 4.3 },
      { id: '3', projectId: 'test-project-id', title: 'Done', status: 'done', devPoints: 2, bizPoints: 8, priority: 4 },
      { id: '4', projectId: 'other-project', title: 'Other', status: 'to-do', devPoints: 1, bizPoints: 1, priority: 1 },
    ]);

    const tasks = await getTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe('High');
    expect(tasks[1].title).toBe('Low');
    expect(tasks[0].devPoints).toBe(3);
  });

  it('returns empty array when no project ID', async () => {
    const { config } = await import('../config.js');
    const original = config.defaultProjectId;
    config.defaultProjectId = '';

    const tasks = await getTasks();
    expect(tasks).toEqual([]);

    config.defaultProjectId = original;
  });

  it('returns empty array when no to-do tasks exist', async () => {
    getAll.mockResolvedValue([
      { id: '1', projectId: 'test-project-id', title: 'Done', status: 'done', devPoints: 2, bizPoints: 8, priority: 4 },
    ]);

    const tasks = await getTasks();
    expect(tasks).toEqual([]);
  });
});

describe('getBacklog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns backlog summary with active sprint', async () => {
    getAll.mockImplementation((path) => {
      if (path === 'tasks') {
        return Promise.resolve([
          { id: '1', projectId: 'test-project-id', status: 'to-do', devPoints: 5, sprintId: 'sp1' },
          { id: '2', projectId: 'test-project-id', status: 'to-do', devPoints: 3, sprintId: 'sp1' },
          { id: '3', projectId: 'test-project-id', status: 'in-progress', devPoints: 8, sprintId: 'sp1' },
          { id: '4', projectId: 'test-project-id', status: 'done', devPoints: 2, sprintId: 'sp1' },
        ]);
      }
      if (path === 'sprints') {
        return Promise.resolve([
          { id: 'sp1', projectId: 'test-project-id', name: 'Sprint 1', status: 'active', startDate: '2026-03-01', endDate: '2026-03-14' },
        ]);
      }
      return Promise.resolve([]);
    });

    const backlog = await getBacklog();
    expect(backlog.pendingCount).toBe(2);
    expect(backlog.inProgressCount).toBe(1);
    expect(backlog.doneCount).toBe(1);
    expect(backlog.totalTasks).toBe(4);
    expect(backlog.totalDevPoints).toBe(8);
    expect(backlog.activeSprint).not.toBeNull();
    expect(backlog.activeSprint.name).toBe('Sprint 1');
    expect(backlog.activeSprint.totalTasks).toBe(4);
    expect(backlog.activeSprint.completedTasks).toBe(1);
  });

  it('returns null activeSprint when none is active', async () => {
    getAll.mockImplementation((path) => {
      if (path === 'tasks') return Promise.resolve([]);
      if (path === 'sprints') {
        return Promise.resolve([
          { id: 'sp1', projectId: 'test-project-id', name: 'Sprint 1', status: 'completed' },
        ]);
      }
      return Promise.resolve([]);
    });

    const backlog = await getBacklog();
    expect(backlog.activeSprint).toBeNull();
    expect(backlog.pendingCount).toBe(0);
  });

  it('returns error when no project ID configured', async () => {
    const { config } = await import('../config.js');
    const original = config.defaultProjectId;
    config.defaultProjectId = '';

    const backlog = await getBacklog();
    expect(backlog.error).toBeDefined();

    config.defaultProjectId = original;
  });
});
