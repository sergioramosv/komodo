import { describe, it, expect } from 'vitest';
import { filterBlockedTasks } from './planner.js';

describe('filterBlockedTasks', () => {
  const makeTasks = (overrides) =>
    overrides.map((o, i) => ({
      id: o.id || `task-${i}`,
      title: o.title || `Task ${i}`,
      status: o.status || 'to-do',
      priority: o.priority || 1,
      blockedBy: o.blockedBy || [],
    }));

  it('returns all tasks as eligible when none have blockedBy', () => {
    const todoTasks = makeTasks([
      { id: 'a', title: 'Task A' },
      { id: 'b', title: 'Task B' },
    ]);
    const allTasks = [...todoTasks];

    const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

    expect(eligible).toHaveLength(2);
    expect(blocked).toHaveLength(0);
  });

  it('filters out a task blocked by a non-done task', () => {
    const allTasks = makeTasks([
      { id: 'blocker-1', title: 'Blocker', status: 'in-progress' },
      { id: 'task-a', title: 'Unblocked Task' },
      { id: 'task-b', title: 'Blocked Task', blockedBy: ['blocker-1'] },
    ]);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');

    const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('task-a');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].task.id).toBe('task-b');
    expect(blocked[0].unresolvedBlockers[0].id).toBe('blocker-1');
    expect(blocked[0].unresolvedBlockers[0].status).toBe('in-progress');
  });

  it('allows a task whose blockers are all done', () => {
    const allTasks = makeTasks([
      { id: 'blocker-1', title: 'Done Blocker', status: 'done' },
      { id: 'blocker-2', title: 'Done Blocker 2', status: 'done' },
      { id: 'task-a', title: 'Depends on done blockers', blockedBy: ['blocker-1', 'blocker-2'] },
    ]);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');

    const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('task-a');
    expect(blocked).toHaveLength(0);
  });

  it('blocks a task if at least one blocker is not done', () => {
    const allTasks = makeTasks([
      { id: 'blocker-1', title: 'Done Blocker', status: 'done' },
      { id: 'blocker-2', title: 'WIP Blocker', status: 'in-progress' },
      { id: 'task-a', title: 'Partially blocked', blockedBy: ['blocker-1', 'blocker-2'] },
    ]);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');

    const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

    expect(eligible).toHaveLength(0);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].unresolvedBlockers).toHaveLength(1);
    expect(blocked[0].unresolvedBlockers[0].id).toBe('blocker-2');
  });

  it('a blocked task with highest priority is NOT eligible', () => {
    const allTasks = makeTasks([
      { id: 'dep', title: 'Dependency', status: 'to-do', priority: 1 },
      { id: 'high-pri', title: 'High Priority Blocked', status: 'to-do', priority: 10, blockedBy: ['dep'] },
      { id: 'low-pri', title: 'Low Priority Free', status: 'to-do', priority: 2 },
    ]);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');

    const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

    // high-pri is blocked by dep (status: to-do, not done)
    expect(eligible.map(t => t.id)).toContain('dep');
    expect(eligible.map(t => t.id)).toContain('low-pri');
    expect(eligible.map(t => t.id)).not.toContain('high-pri');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].task.id).toBe('high-pri');
  });

  it('returns all blocked when every to-do task is blocked', () => {
    const allTasks = makeTasks([
      { id: 'wip', title: 'In Progress', status: 'in-progress' },
      { id: 'task-a', title: 'Blocked A', blockedBy: ['wip'] },
      { id: 'task-b', title: 'Blocked B', blockedBy: ['wip'] },
    ]);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');

    const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

    expect(eligible).toHaveLength(0);
    expect(blocked).toHaveLength(2);
  });

  it('handles blockedBy referencing a non-existent task as blocked', () => {
    const allTasks = makeTasks([
      { id: 'task-a', title: 'Blocked by ghost', blockedBy: ['non-existent-id'] },
    ]);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');

    const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

    expect(eligible).toHaveLength(0);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].unresolvedBlockers[0].status).toBe('(not found)');
  });

  it('handles tasks with undefined or null blockedBy gracefully', () => {
    const todoTasks = [
      { id: 'a', title: 'No field', status: 'to-do', priority: 1 },
      { id: 'b', title: 'Null field', status: 'to-do', priority: 1, blockedBy: null },
      { id: 'c', title: 'Empty array', status: 'to-do', priority: 1, blockedBy: [] },
    ];
    const allTasks = [...todoTasks];

    const { eligible, blocked } = filterBlockedTasks(todoTasks, allTasks);

    expect(eligible).toHaveLength(3);
    expect(blocked).toHaveLength(0);
  });
});
