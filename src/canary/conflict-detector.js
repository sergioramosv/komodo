/**
 * Parallel conflict detector for canary merge.
 *
 * Tracks which files each active task has modified. When a new task's
 * filesChanged overlap with files registered by another active task,
 * a conflict alert is emitted.
 */

import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

const AGENT = 'CANARY';

/**
 * Map<taskId, Set<string>> — files currently owned by each active task.
 * @type {Map<string, Set<string>>}
 */
const activeTaskFiles = new Map();

/**
 * Registers the files modified by a task as "active".
 * Call this right after the Coder delivers filesChanged.
 *
 * @param {string} taskId
 * @param {string[]} filesChanged
 */
export function registerActiveTaskFiles(taskId, filesChanged) {
  if (!taskId || !Array.isArray(filesChanged) || filesChanged.length === 0) return;
  activeTaskFiles.set(taskId, new Set(filesChanged));
  logger.debug(`Registered ${filesChanged.length} active files for task ${taskId}`, AGENT);
}

/**
 * Unregisters a task's active files (call after merge or rollback).
 *
 * @param {string} taskId
 */
export function unregisterActiveTaskFiles(taskId) {
  if (!taskId) return;
  activeTaskFiles.delete(taskId);
  logger.debug(`Unregistered active files for task ${taskId}`, AGENT);
}

/**
 * Checks whether the given files conflict with files owned by any other
 * currently-active task (i.e. in-flight parallel tasks).
 *
 * Emits CANARY_PARALLEL_CONFLICT for every conflicting pair found.
 *
 * @param {string} taskId - The task being checked
 * @param {string[]} filesChanged - Files changed by this task
 * @returns {{ conflicts: Array<{ conflictingTaskId: string, files: string[] }> }}
 */
export function detectParallelConflicts(taskId, filesChanged) {
  if (!taskId || !Array.isArray(filesChanged) || filesChanged.length === 0) {
    return { conflicts: [] };
  }

  const conflicts = [];

  for (const [otherTaskId, otherFiles] of activeTaskFiles) {
    if (otherTaskId === taskId) continue;

    const overlapping = filesChanged.filter(f => otherFiles.has(f));
    if (overlapping.length > 0) {
      conflicts.push({ conflictingTaskId: otherTaskId, files: overlapping });

      logger.warn(
        `Parallel conflict detected: task ${taskId} and ${otherTaskId} both modified [${overlapping.join(', ')}]`,
        AGENT,
      );

      eventBus.emitEvent(EVENT_TYPES.CANARY_PARALLEL_CONFLICT, {
        metadata: {
          taskId,
          conflictingTaskId: otherTaskId,
          files: overlapping,
        },
      });
    }
  }

  return { conflicts };
}
