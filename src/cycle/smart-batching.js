import { fetchProjectTasks, filterBlockedTasks } from '../agents/planner.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

/**
 * Detects consecutive trivial tasks (devPoints <= 2) in the backlog
 * that have no unresolved dependencies.
 *
 * @param {string} projectId
 * @returns {Promise<Object[]>} Array of trivial task objects eligible for batching
 */
export async function detectTrivialTasks(projectId) {
  const allTasks = await fetchProjectTasks(projectId);
  const todoTasks = allTasks.filter(t => t.status === 'to-do');

  if (todoTasks.length === 0) return [];

  const { eligible } = filterBlockedTasks(todoTasks, allTasks);

  // Filter to trivial tasks only (devPoints <= 2)
  const trivial = eligible.filter(t => {
    const devPoints = t.devPoints ?? t.dev_points ?? 0;
    return devPoints > 0 && devPoints <= 2;
  });

  return trivial;
}

/**
 * Groups trivial tasks into a batch, respecting BATCH_MAX_TASKS limit.
 *
 * @param {Object[]} trivialTasks - Array of trivial tasks from detectTrivialTasks
 * @param {Object} [options]
 * @param {number} [options.maxTasks] - Override BATCH_MAX_TASKS config
 * @returns {{ shouldBatch: boolean, batch: Object[], reason: string }}
 */
export function groupBatch(trivialTasks, options = {}) {
  const maxTasks = options.maxTasks || config.batchMaxTasks || 5;

  if (!trivialTasks || trivialTasks.length < 2) {
    return {
      shouldBatch: false,
      batch: [],
      reason: trivialTasks?.length === 1
        ? 'Only 1 trivial task found, not enough for a batch'
        : 'No trivial tasks found',
    };
  }

  const batch = trivialTasks.slice(0, maxTasks);

  return {
    shouldBatch: true,
    batch,
    reason: `${batch.length} trivial tasks grouped for batching`,
  };
}

/**
 * Builds the branch name for a batch based on the sprint.
 *
 * @param {string} [sprintId] - Sprint identifier
 * @returns {string} Branch name like "batch/sprint-1-trivial-fixes"
 */
export function buildBatchBranchName(sprintId) {
  const sprintSlug = sprintId
    ? sprintId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
    : 'general';
  return `batch/${sprintSlug}-trivial-fixes`;
}

/**
 * Builds the PR title and body for a batch of tasks.
 *
 * @param {Object[]} batch - Array of task objects in the batch
 * @returns {{ title: string, body: string }}
 */
export function buildBatchPR(batch) {
  const title = `Batch: ${batch.length} trivial fixes`;

  const taskList = batch
    .map((t, i) => `${i + 1}. **${t.title}** (${t.id}) — ${t.devPoints ?? t.dev_points ?? 0} devPoints`)
    .join('\n');

  const body = `## Changes

Batch of ${batch.length} trivial tasks grouped into a single PR.

### Tasks included
${taskList}

## Test plan
- [ ] Each commit implements one trivial task
- [ ] All tasks pass acceptance criteria
- [ ] No regressions introduced`;

  return { title, body };
}

/**
 * Determines which commit in a batch was rejected by review and extracts it.
 *
 * @param {Object[]} batch - The original batch of tasks
 * @param {Object} reviewFeedback - Feedback from the reviewer
 * @param {string[]} reviewFeedback.rejectedTaskIds - Task IDs that were specifically rejected
 * @returns {{ remaining: Object[], separated: Object[] }}
 */
export function separateRejectedTasks(batch, reviewFeedback) {
  const rejectedIds = new Set(reviewFeedback.rejectedTaskIds || []);

  if (rejectedIds.size === 0) {
    return { remaining: batch, separated: [] };
  }

  const remaining = [];
  const separated = [];

  for (const task of batch) {
    if (rejectedIds.has(task.id)) {
      separated.push(task);
    } else {
      remaining.push(task);
    }
  }

  return { remaining, separated };
}

/**
 * Main entry point: detect, group, and prepare a batch of trivial tasks.
 *
 * Returns null if batching is disabled or no batch is possible.
 *
 * @param {string} projectId
 * @param {Object} [options]
 * @param {number} [options.maxTasks] - Override BATCH_MAX_TASKS
 * @returns {Promise<{
 *   batch: Object[],
 *   branchName: string,
 *   pr: { title: string, body: string },
 * } | null>}
 */
export async function prepareBatch(projectId, options = {}) {
  if (!config.smartBatching) {
    logger.info('Smart batching disabled (SMART_BATCHING=false)', 'KOMODO');
    return null;
  }

  const trivialTasks = await detectTrivialTasks(projectId);
  const { shouldBatch, batch, reason } = groupBatch(trivialTasks, options);

  logger.info(`Smart batching: ${reason}`, 'KOMODO');

  if (!shouldBatch) {
    return null;
  }

  // Determine sprint from first task (all should be in same sprint ideally)
  const sprintId = batch[0].sprintId || batch[0].sprint || null;
  const branchName = buildBatchBranchName(sprintId);
  const pr = buildBatchPR(batch);

  eventBus.emitEvent(EVENT_TYPES.BATCH_PREPARED, {
    metadata: {
      taskCount: batch.length,
      taskIds: batch.map(t => t.id),
      branchName,
    },
  });

  return { batch, branchName, pr };
}
