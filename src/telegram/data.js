import { komodoState, PHASES, EXECUTION_STATES } from '../state/komodo-state.js';
import { config } from '../config.js';
import { getAll, getById } from '../../skills/planning-task-mcp/src/firebase.js';

/**
 * Returns the current Komodo execution status from in-memory state.
 *
 * @returns {Object} Status snapshot with execution state, phase, active agent, task, and elapsed time.
 */
export function getStatus() {
  const snapshot = komodoState.getSnapshot();

  const activeAgent = Object.entries(snapshot.agents)
    .find(([, a]) => a.status === 'working');

  let elapsedMs = null;
  if (activeAgent && activeAgent[1].startedAt) {
    elapsedMs = Date.now() - new Date(activeAgent[1].startedAt).getTime();
  }

  return {
    executionState: snapshot.executionState,
    phase: snapshot.phase,
    activeAgent: activeAgent ? { name: activeAgent[0], status: activeAgent[1].status } : null,
    currentTask: snapshot.taskDetails || null,
    currentPR: snapshot.currentPR || null,
    reviewCycle: snapshot.reviewCycle,
    tasksCompleted: snapshot.tasksCompleted,
    totalTasks: snapshot.totalTasks,
    elapsedMs,
  };
}

/**
 * Fetches to-do tasks from Firebase, sorted by priority (highest first).
 *
 * @param {string} [projectId] - Project ID. Falls back to DEFAULT_PROJECT_ID.
 * @returns {Promise<Array>} Tasks with id, title, devPoints, bizPoints, priority, status.
 */
export async function getTasks(projectId) {
  const pid = projectId || config.defaultProjectId;
  if (!pid) return [];

  const tasks = await getAll('tasks');
  return tasks
    .filter(t => t.projectId === pid && t.status === 'to-do')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map(t => ({
      id: t.id,
      title: t.title,
      devPoints: t.devPoints || 0,
      bizPoints: t.bizPoints || 0,
      priority: t.priority || 0,
      status: t.status,
    }));
}

/**
 * Fetches a backlog summary: pending task count, total dev points, active sprint info.
 *
 * @param {string} [projectId] - Project ID. Falls back to DEFAULT_PROJECT_ID.
 * @returns {Promise<Object>} Backlog summary.
 */
export async function getBacklog(projectId) {
  const pid = projectId || config.defaultProjectId;
  if (!pid) return { error: 'No project ID configured' };

  const [allTasks, allSprints] = await Promise.all([
    getAll('tasks'),
    getAll('sprints'),
  ]);

  const tasks = allTasks.filter(t => t.projectId === pid);
  const sprints = allSprints.filter(s => s.projectId === pid);
  const activeSprint = sprints.find(s => s.status === 'active') || null;

  const pending = tasks.filter(t => t.status === 'to-do');
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const done = tasks.filter(t => t.status === 'done');
  const totalDevPoints = pending.reduce((sum, t) => sum + (t.devPoints || 0), 0);

  let sprintInfo = null;
  if (activeSprint) {
    const sprintTasks = tasks.filter(t => t.sprintId === activeSprint.id);
    const sprintDone = sprintTasks.filter(t => t.status === 'done').length;
    sprintInfo = {
      name: activeSprint.name,
      startDate: activeSprint.startDate,
      endDate: activeSprint.endDate,
      totalTasks: sprintTasks.length,
      completedTasks: sprintDone,
    };
  }

  return {
    pendingCount: pending.length,
    inProgressCount: inProgress.length,
    doneCount: done.length,
    totalTasks: tasks.length,
    totalDevPoints,
    activeSprint: sprintInfo,
  };
}
