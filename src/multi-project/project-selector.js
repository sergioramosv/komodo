import { fetchProjectTasks, filterBlockedTasks } from '../agents/planner.js';
import { logger } from '../utils/logger.js';

const AGENT = 'MULTI-PROJECT';

/**
 * Valid selection strategies.
 */
export const STRATEGIES = {
  ROUND_ROBIN: 'round-robin',
  PRIORITY: 'priority',
  BACKLOG_SIZE: 'backlog-size',
};

/**
 * Selects the next project to work on based on the configured strategy.
 *
 * @param {string[]} projectIds - List of project IDs to choose from
 * @param {string} strategy - Selection strategy (round-robin|priority|backlog-size)
 * @param {{ lastIndex: number }} context - Mutable context for stateful strategies (round-robin)
 * @returns {Promise<{ projectId: string, eligible: number } | null>} Selected project or null if all empty
 */
export async function selectNextProject(projectIds, strategy, context) {
  if (!projectIds || projectIds.length === 0) return null;

  switch (strategy) {
    case STRATEGIES.ROUND_ROBIN:
      return _roundRobin(projectIds, context);
    case STRATEGIES.PRIORITY:
      return _priority(projectIds);
    case STRATEGIES.BACKLOG_SIZE:
      return _backlogSize(projectIds);
    default:
      logger.warn(`Unknown strategy "${strategy}", falling back to round-robin`, AGENT);
      return _roundRobin(projectIds, context);
  }
}

/**
 * Round-robin: cycles through projects in order, skipping those with empty backlogs.
 *
 * @param {string[]} projectIds
 * @param {{ lastIndex: number }} context
 * @returns {Promise<{ projectId: string, eligible: number } | null>}
 */
async function _roundRobin(projectIds, context) {
  const len = projectIds.length;

  for (let i = 0; i < len; i++) {
    const idx = (context.lastIndex + 1 + i) % len;
    const projectId = projectIds[idx];

    const eligible = await _getEligibleCount(projectId);
    if (eligible > 0) {
      context.lastIndex = idx;
      logger.info(`Round-robin selected project: ${projectId} (${eligible} eligible tasks)`, AGENT);
      return { projectId, eligible };
    }
  }

  return null;
}

/**
 * Priority: selects the project whose highest-priority eligible task has the highest priority globally.
 * Lower priority number = higher priority (1 is most urgent).
 *
 * @param {string[]} projectIds
 * @returns {Promise<{ projectId: string, eligible: number } | null>}
 */
async function _priority(projectIds) {
  let bestProject = null;
  let bestPriority = Infinity;
  let bestEligible = 0;

  for (const projectId of projectIds) {
    const { eligible, topPriority } = await _getEligibleWithPriority(projectId);
    if (eligible > 0 && topPriority < bestPriority) {
      bestProject = projectId;
      bestPriority = topPriority;
      bestEligible = eligible;
    }
  }

  if (bestProject) {
    logger.info(`Priority selected project: ${bestProject} (top priority: ${bestPriority}, ${bestEligible} eligible)`, AGENT);
    return { projectId: bestProject, eligible: bestEligible };
  }

  return null;
}

/**
 * Backlog-size: selects the project with the most eligible tasks.
 *
 * @param {string[]} projectIds
 * @returns {Promise<{ projectId: string, eligible: number } | null>}
 */
async function _backlogSize(projectIds) {
  let bestProject = null;
  let maxEligible = 0;

  for (const projectId of projectIds) {
    const eligible = await _getEligibleCount(projectId);
    if (eligible > maxEligible) {
      bestProject = projectId;
      maxEligible = eligible;
    }
  }

  if (bestProject) {
    logger.info(`Backlog-size selected project: ${bestProject} (${maxEligible} eligible tasks)`, AGENT);
    return { projectId: bestProject, eligible: maxEligible };
  }

  return null;
}

/**
 * Returns the count of eligible (non-blocked) to-do tasks for a project.
 *
 * @param {string} projectId
 * @returns {Promise<number>}
 */
async function _getEligibleCount(projectId) {
  try {
    const allTasks = await fetchProjectTasks(projectId);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');
    if (todoTasks.length === 0) return 0;
    const { eligible } = filterBlockedTasks(todoTasks, allTasks);
    return eligible.length;
  } catch (err) {
    logger.warn(`Error fetching tasks for project ${projectId}: ${err.message}`, AGENT);
    return 0;
  }
}

/**
 * Returns the count of eligible tasks and the top (lowest number) priority among them.
 *
 * @param {string} projectId
 * @returns {Promise<{ eligible: number, topPriority: number }>}
 */
async function _getEligibleWithPriority(projectId) {
  try {
    const allTasks = await fetchProjectTasks(projectId);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');
    if (todoTasks.length === 0) return { eligible: 0, topPriority: Infinity };

    const { eligible } = filterBlockedTasks(todoTasks, allTasks);
    if (eligible.length === 0) return { eligible: 0, topPriority: Infinity };

    // Lower priority number = more urgent. Default to 999 if no priority set.
    const topPriority = Math.min(...eligible.map(t => t.priority ?? 999));
    return { eligible: eligible.length, topPriority };
  } catch (err) {
    logger.warn(`Error fetching tasks for project ${projectId}: ${err.message}`, AGENT);
    return { eligible: 0, topPriority: Infinity };
  }
}
