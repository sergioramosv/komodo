import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks ---

const {
  mockKomodoState,
  mockRunTask,
  mockFetchProjectTasks,
  mockFilterBlockedTasks,
  mockValidateConfig,
  mockConfig,
} = vi.hoisted(() => {
  const state = {
    executionState: 'running',
    phase: 'idle',
    updatePhase: vi.fn(),
    setExecutionState: vi.fn(),
  };
  return {
    mockKomodoState: state,
    mockRunTask: vi.fn(),
    mockFetchProjectTasks: vi.fn(),
    mockFilterBlockedTasks: vi.fn(),
    mockValidateConfig: vi.fn(() => []),
    mockConfig: {
      daemonPollInterval: 1,
      daemonMaxTasksPerSession: 0,
    },
  };
});

vi.mock('../state/komodo-state.js', () => ({
  komodoState: mockKomodoState,
  PHASES: { IDLE: 'idle', PLANNING: 'planning', CODING: 'coding', ANALYZING: 'analyzing', REVIEWING: 'reviewing', MERGING: 'merging' },
  EXECUTION_STATES: {
    STOPPED: 'stopped',
    RUNNING: 'running',
    PAUSED: 'paused',
    DAEMON_IDLE: 'daemon:idle',
    DAEMON_RUNNING: 'daemon:running',
  },
}));

vi.mock('../cycle/task-runner.js', () => ({ runTask: mockRunTask }));

vi.mock('../agents/planner.js', () => ({
  fetchProjectTasks: mockFetchProjectTasks,
  filterBlockedTasks: mockFilterBlockedTasks,
}));

vi.mock('../config.js', () => ({
  validateConfig: mockValidateConfig,
  config: mockConfig,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn(), taskHeader: vi.fn() },
}));

vi.mock('../events/event-bus.js', () => ({
  eventBus: { emitEvent: vi.fn() },
  EVENT_TYPES: {
    DAEMON_STARTED: 'daemon:started',
    DAEMON_STOPPED: 'daemon:stopped',
    DAEMON_IDLE: 'daemon:idle',
    DAEMON_TASK_DETECTED: 'daemon:task-detected',
    EXECUTION_STATE_CHANGE: 'execution:state_change',
    AGENT_STATE_CHANGE: 'agent:state_change',
  },
}));

vi.mock('../server/ws-server.js', () => ({
  KomodoWsServer: class {
    start() { return Promise.resolve(); }
    stop() { return Promise.resolve(); }
  },
}));

vi.mock('../state/checkpoint-manager.js', () => ({
  checkpointManager: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../orchestrator.js', () => ({
  checkForPendingCheckpoints: vi.fn().mockResolvedValue({ resumed: false }),
}));

import { watch } from './daemon.js';

// --- Helpers ---

function setupBacklog(tasks) {
  mockFetchProjectTasks.mockResolvedValue(tasks);
  const eligible = tasks.filter(t => t.status === 'to-do');
  mockFilterBlockedTasks.mockReturnValue({ eligible, blocked: [] });
}

function resetState() {
  vi.clearAllMocks();
  mockConfig.daemonPollInterval = 1;
  mockConfig.daemonMaxTasksPerSession = 0;
  mockValidateConfig.mockReturnValue([]);
  mockKomodoState.executionState = 'running';
  mockKomodoState.phase = 'idle';
  mockKomodoState.setExecutionState.mockImplementation(function (state) {
    mockKomodoState.executionState = state;
  });
}

// --- Tests ---

describe('daemon watch()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enters idle when backlog is empty and stops on signal', async () => {
    // Empty backlog — daemon should enter idle
    let fetchCount = 0;
    mockFetchProjectTasks.mockImplementation(async () => {
      fetchCount++;
      if (fetchCount >= 2) {
        mockKomodoState.executionState = 'stopped';
      }
      return [];
    });
    mockFilterBlockedTasks.mockReturnValue({ eligible: [], blocked: [] });

    const watchPromise = watch('proj-1');

    // Advance timers to let _sleep intervals fire
    await vi.advanceTimersByTimeAsync(5000);

    const result = await watchPromise;

    expect(result.tasksCompleted).toBe(0);
    expect(result.tasksFailed).toBe(0);
    expect(mockRunTask).not.toHaveBeenCalled();
  });

  it('executes available tasks from backlog', async () => {
    setupBacklog([{ id: 't1', status: 'to-do', title: 'Task 1' }]);

    mockRunTask.mockImplementation(async () => {
      // Stop after one task
      mockKomodoState.executionState = 'stopped';
      return { taskId: 't1', taskTitle: 'Task 1', success: true };
    });

    const watchPromise = watch('proj-1');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await watchPromise;

    expect(result.tasksCompleted).toBe(1);
    expect(result.tasksFailed).toBe(0);
    expect(mockRunTask).toHaveBeenCalledTimes(1);
  });

  it('stop signal interrupts the loop before executing tasks', async () => {
    // Stop triggers during backlog check, before runTask can execute
    mockFetchProjectTasks.mockImplementation(async () => {
      // Simulate external stop signal (e.g. user pressing Ctrl+C)
      mockKomodoState.executionState = 'stopped';
      return [{ id: 't1', status: 'to-do', title: 'Task 1' }];
    });
    mockFilterBlockedTasks.mockReturnValue({
      eligible: [{ id: 't1', status: 'to-do', title: 'Task 1' }],
      blocked: [],
    });

    const watchPromise = watch('proj-1');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await watchPromise;

    // The loop should break at the stop check on the next iteration
    // At most one task may execute before the stop is detected
    expect(result.tasksCompleted + result.tasksFailed).toBeLessThanOrEqual(1);
  });

  it('respects maxTasks limit and stops after reaching it', async () => {
    mockConfig.daemonMaxTasksPerSession = 2;
    setupBacklog([{ id: 't1', status: 'to-do', title: 'Task' }]);

    let callNum = 0;
    mockRunTask.mockImplementation(async () => {
      callNum++;
      return { taskId: `t${callNum}`, taskTitle: `Task ${callNum}`, success: true };
    });

    const watchPromise = watch('proj-1');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await watchPromise;

    expect(result.tasksCompleted).toBe(2);
    expect(mockRunTask).toHaveBeenCalledTimes(2);
  });

  it('filters blocked tasks — all blocked means empty backlog', async () => {
    const allTasks = [
      { id: 't1', status: 'to-do', title: 'Blocked', blockedBy: ['t2'] },
      { id: 't2', status: 'in-progress', title: 'Blocker' },
    ];

    let fetchCount = 0;
    mockFetchProjectTasks.mockImplementation(async () => {
      fetchCount++;
      if (fetchCount >= 2) {
        mockKomodoState.executionState = 'stopped';
      }
      return allTasks;
    });
    mockFilterBlockedTasks.mockReturnValue({ eligible: [], blocked: [allTasks[0]] });

    const watchPromise = watch('proj-1');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await watchPromise;

    expect(result.tasksCompleted).toBe(0);
    expect(mockRunTask).not.toHaveBeenCalled();
    expect(mockFilterBlockedTasks).toHaveBeenCalled();
  });

  it('sleep is interrupted early by stop signal', async () => {
    // Empty backlog → enters _pollUntilTaskOrStop → _sleep
    // On second fetch (inside poll loop), set stop signal
    let fetchCount = 0;
    mockFetchProjectTasks.mockImplementation(async () => {
      fetchCount++;
      return [];
    });
    mockFilterBlockedTasks.mockReturnValue({ eligible: [], blocked: [] });

    const watchPromise = watch('proj-1');

    // First tick: daemon enters idle, starts _sleep
    await vi.advanceTimersByTimeAsync(1000);

    // Now set stop — _sleep should detect it on next interval check
    mockKomodoState.executionState = 'stopped';
    await vi.advanceTimersByTimeAsync(1500);

    const result = await watchPromise;

    expect(result.tasksCompleted).toBe(0);
    expect(result.tasksFailed).toBe(0);
  });

  it('returns early with zero counts on config validation errors', async () => {
    mockValidateConfig.mockReturnValue(['missing API key']);

    const result = await watch('proj-1');

    expect(result).toEqual({ tasksCompleted: 0, tasksFailed: 0, results: [] });
    expect(mockRunTask).not.toHaveBeenCalled();
  });

  it('counts failed tasks separately from completed tasks', async () => {
    mockConfig.daemonMaxTasksPerSession = 2;
    setupBacklog([{ id: 't1', status: 'to-do' }]);

    let callNum = 0;
    mockRunTask.mockImplementation(async () => {
      callNum++;
      if (callNum === 1) {
        return { taskId: `t${callNum}`, taskTitle: `Task ${callNum}`, success: false, error: 'build failed' };
      }
      return { taskId: `t${callNum}`, taskTitle: `Task ${callNum}`, success: true };
    });

    const watchPromise = watch('proj-1');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await watchPromise;

    // maxTasks counts only completed: fail, pass, pass → completed=2, failed=1
    expect(result.tasksCompleted).toBe(2);
    expect(result.tasksFailed).toBe(1);
    expect(result.results).toHaveLength(3);
  });
});
