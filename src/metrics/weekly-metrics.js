import { logger } from '../utils/logger.js';
import { getAll, getDb } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT_TAG = 'WEEKLY-METRICS';

/**
 * Returns start/end timestamps (ms) for a week window.
 *
 * Week starts on Monday. weekOffset=0 = current week, -1 = last week.
 *
 * @param {number} weekOffset
 * @param {Date} [referenceDate]
 * @returns {{ startMs: number, endMs: number, startIso: string, endIso: string }}
 */
export function getWeekRange(weekOffset = 0, referenceDate = new Date()) {
  const ref = new Date(referenceDate);
  // Set to Monday of the reference week
  const dayOfWeek = ref.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(ref);
  monday.setDate(ref.getDate() - daysFromMonday + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);

  return {
    startMs: monday.getTime(),
    endMs: nextMonday.getTime() - 1,
    startIso: monday.toISOString(),
    endIso: new Date(nextMonday.getTime() - 1).toISOString(),
  };
}

/**
 * @typedef {Object} CompletedTask
 * @property {string} taskId
 * @property {string} title
 * @property {number} bizPoints
 * @property {number} devPoints
 * @property {string} completedAt
 */

/**
 * @typedef {Object} CriticalBug
 * @property {string} id
 * @property {string} title
 * @property {string} severity
 * @property {string} status
 * @property {boolean} warning
 */

/**
 * @typedef {Object} VelocityTrend
 * @property {number} currentWeekDevPoints
 * @property {number} previousWeekDevPoints
 * @property {'up'|'down'|'stable'} trend
 * @property {number} changePercent
 */

/**
 * @typedef {Object} WeeklyMetrics
 * @property {string} projectId
 * @property {string} weekStart
 * @property {string} weekEnd
 * @property {number} tasksCompleted
 * @property {number} prsMerged
 * @property {number} bugsFound
 * @property {number} bugsResolved
 * @property {number} totalCost
 * @property {VelocityTrend} velocity
 * @property {CompletedTask[]} topTasks
 * @property {CriticalBug[]} criticalBugsOpen
 */

/**
 * Fetches execution metrics records for a project from Firebase.
 *
 * @param {string} projectId
 * @returns {Promise<Array<Object>>}
 */
async function fetchMetricsRecords(projectId) {
  try {
    const db = getDb();
    const snapshot = await db.ref(`metrics/${projectId}/tasks`).once('value');
    const data = snapshot.val();
    if (!data) return [];
    return Object.values(data);
  } catch (err) {
    logger.warn(`Failed to load metrics records: ${err.message}`, AGENT_TAG);
    return [];
  }
}

/**
 * Calculates the velocity trend between two weeks.
 *
 * @param {number} current - devPoints completed this week
 * @param {number} previous - devPoints completed last week
 * @returns {VelocityTrend}
 */
export function calculateVelocityTrend(current, previous) {
  let trend;
  let changePercent;

  if (previous === 0) {
    trend = current > 0 ? 'up' : 'stable';
    changePercent = current > 0 ? 100 : 0;
  } else {
    changePercent = Math.round(((current - previous) / previous) * 100);
    if (current > previous) trend = 'up';
    else if (current < previous) trend = 'down';
    else trend = 'stable';
  }

  return {
    currentWeekDevPoints: current,
    previousWeekDevPoints: previous,
    trend,
    changePercent,
  };
}

/**
 * Collects all weekly metrics for a project from Firebase.
 *
 * Aggregates:
 * - tasksCompleted: tasks with a metrics record (completedAt) within the week
 * - prsMerged: metrics records where merged === true within the week
 * - bugsFound: bugs created within the week
 * - bugsResolved: bugs moved to 'resolved' or 'closed' within the week
 * - totalCost: sum of cost from metrics records within the week
 * - velocity: devPoints completed this week vs last week with trend indicator
 * - topTasks: top 3 completed tasks ordered by bizPoints (descending)
 * - criticalBugsOpen: open bugs with severity 'critical', marked with warning: true
 *
 * @param {string} projectId
 * @param {Object} [options]
 * @param {Date} [options.referenceDate] - Reference date for week calculation (default: now)
 * @returns {Promise<WeeklyMetrics>}
 */
export async function collectWeeklyMetrics(projectId, { referenceDate } = {}) {
  const currentWeek = getWeekRange(0, referenceDate);
  const previousWeek = getWeekRange(-1, referenceDate);

  const [allTasks, allBugs, metricsRecords] = await Promise.all([
    getAll('tasks').catch(err => {
      logger.warn(`Failed to load tasks: ${err.message}`, AGENT_TAG);
      return [];
    }),
    getAll('bugs').catch(err => {
      logger.warn(`Failed to load bugs: ${err.message}`, AGENT_TAG);
      return [];
    }),
    fetchMetricsRecords(projectId),
  ]);

  const projectTasks = allTasks.filter(t => t.projectId === projectId);
  const projectBugs = allBugs.filter(b => b.projectId === projectId);

  // Index tasks by ID for fast lookup
  const taskById = new Map(projectTasks.map(t => [t.id, t]));

  // --- Current week metrics from execution records ---

  const currentWeekMetrics = metricsRecords.filter(m => {
    const completedMs = m.completedAt ? new Date(m.completedAt).getTime() : 0;
    return completedMs >= currentWeek.startMs && completedMs <= currentWeek.endMs;
  });

  const previousWeekMetrics = metricsRecords.filter(m => {
    const completedMs = m.completedAt ? new Date(m.completedAt).getTime() : 0;
    return completedMs >= previousWeek.startMs && completedMs <= previousWeek.endMs;
  });

  // Tasks completed: based on metrics records this week
  const tasksCompleted = currentWeekMetrics.length;

  // PRs merged: metrics records with merged === true
  const prsMerged = currentWeekMetrics.filter(m => m.merged === true).length;

  // Total cost
  const totalCost = currentWeekMetrics.reduce((sum, m) => sum + (Number.isFinite(m.cost) ? m.cost : 0), 0);

  // --- Velocity: devPoints completed each week ---

  const currentWeekDevPoints = currentWeekMetrics.reduce((sum, m) => {
    const task = taskById.get(m.taskId);
    return sum + (task?.devPoints || m.estimatedDevPoints || 0);
  }, 0);

  const previousWeekDevPoints = previousWeekMetrics.reduce((sum, m) => {
    const task = taskById.get(m.taskId);
    return sum + (task?.devPoints || m.estimatedDevPoints || 0);
  }, 0);

  const velocity = calculateVelocityTrend(currentWeekDevPoints, previousWeekDevPoints);

  // --- Top 3 tasks by bizPoints ---

  const completedWithDetails = currentWeekMetrics
    .map(m => {
      const task = taskById.get(m.taskId);
      if (!task) return null;
      return {
        taskId: m.taskId,
        title: task.title || '',
        bizPoints: task.bizPoints || 0,
        devPoints: task.devPoints || m.estimatedDevPoints || 0,
        completedAt: m.completedAt,
      };
    })
    .filter(Boolean);

  const topTasks = completedWithDetails
    .sort((a, b) => b.bizPoints - a.bizPoints)
    .slice(0, 3);

  // --- Bugs found and resolved this week ---

  const bugsFound = projectBugs.filter(b => {
    const createdMs = b.createdAt || 0;
    return createdMs >= currentWeek.startMs && createdMs <= currentWeek.endMs;
  }).length;

  const bugsResolved = projectBugs.filter(b => {
    const updatedMs = b.updatedAt || 0;
    const isResolved = b.status === 'resolved' || b.status === 'closed';
    return isResolved && updatedMs >= currentWeek.startMs && updatedMs <= currentWeek.endMs;
  }).length;

  // --- Critical open bugs (with warning flag) ---

  const criticalBugsOpen = projectBugs
    .filter(b => b.severity === 'critical' && b.status === 'open')
    .map(b => ({
      id: b.id,
      title: b.title || '',
      severity: b.severity,
      status: b.status,
      warning: true,
    }));

  const result = {
    projectId,
    weekStart: currentWeek.startIso,
    weekEnd: currentWeek.endIso,
    tasksCompleted,
    prsMerged,
    bugsFound,
    bugsResolved,
    totalCost: Math.round(totalCost * 10000) / 10000,
    velocity,
    topTasks,
    criticalBugsOpen,
  };

  logger.info(
    `Weekly metrics collected for project ${projectId}: ${tasksCompleted} tasks, ${prsMerged} PRs merged, velocity ${velocity.trend} (${velocity.currentWeekDevPoints}pts), ${criticalBugsOpen.length} critical bugs open`,
    AGENT_TAG,
  );

  return result;
}
