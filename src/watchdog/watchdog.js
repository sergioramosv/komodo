import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

/**
 * Default timeout: 15 minutes without output → agent is hung.
 */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Max retries after killing a hung agent.
 */
const MAX_RETRIES = 2;

/**
 * Wraps an agent runner function with watchdog monitoring.
 *
 * Monitors output activity and kills the agent if no output is produced
 * within AGENT_TIMEOUT_MINUTES (default 15). After a kill, retries
 * automatically up to MAX_RETRIES times. If all retries fail, saves a
 * checkpoint and pauses.
 *
 * @param {Function} agentFn - Async function that runs the agent. Must accept
 *   the same args and return { success, result, error, ... }.
 * @param {Object} options
 * @param {string}   options.agentName    - Agent name (PLANNER, CODER, REVIEWER)
 * @param {string}   [options.taskId]     - Current task ID (for logging)
 * @param {number}   [options.timeoutMs]  - Override timeout in ms
 * @param {number}   [options.maxRetries] - Override max retries (default 2)
 * @param {Function} [options.onCheckpoint] - Called when all retries exhausted
 * @returns {Promise<Object>} The agent result (from successful run or last failed attempt)
 */
export async function withWatchdog(agentFn, options = {}) {
  const {
    agentName = 'UNKNOWN',
    taskId = null,
    timeoutMs = _getTimeoutMs(),
    maxRetries = MAX_RETRIES,
    onCheckpoint,
  } = options;

  let lastResult = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const isRetry = attempt > 0;

    if (isRetry) {
      logger.warn(
        `Watchdog retry ${attempt}/${maxRetries} for ${agentName}${taskId ? ` (task: ${taskId})` : ''}`,
        'KOMODO',
      );

      eventBus.emitEvent(EVENT_TYPES.WATCHDOG_RETRY, {
        agentName,
        metadata: {
          taskId,
          attempt,
          maxRetries,
        },
      });
    }

    lastResult = await agentFn();

    // If the agent completed (success or non-timeout failure), return immediately.
    // We only retry on timeout kills.
    if (lastResult.success || !_isTimeoutError(lastResult.error)) {
      return lastResult;
    }

    // Agent was killed by timeout
    logger.warn(
      `Watchdog: ${agentName} killed (no output for ${timeoutMs / 1000}s)${taskId ? ` | task: ${taskId}` : ''}`,
      'KOMODO',
    );

    eventBus.emitEvent(EVENT_TYPES.WATCHDOG_KILL, {
      agentName,
      metadata: {
        taskId,
        attempt,
        timeoutMs,
        error: lastResult.error,
      },
    });
  }

  // All retries exhausted
  logger.error(
    `Watchdog: all ${maxRetries} retries exhausted for ${agentName}${taskId ? ` (task: ${taskId})` : ''}. Pausing.`,
    'KOMODO',
  );

  eventBus.emitEvent(EVENT_TYPES.WATCHDOG_EXHAUSTED, {
    agentName,
    metadata: {
      taskId,
      maxRetries,
      timeoutMs,
    },
  });

  if (onCheckpoint) {
    await onCheckpoint();
  }

  return lastResult;
}

/**
 * Returns the configured timeout in milliseconds.
 * Reads from AGENT_TIMEOUT_MINUTES env var (default 15).
 */
function _getTimeoutMs() {
  return config.agentTimeoutMinutes * 60 * 1000 || DEFAULT_TIMEOUT_MS;
}

/**
 * Checks if an error message indicates a timeout kill.
 * Matches the error strings produced by spawnCli in base-agent.js.
 */
function _isTimeoutError(errorMsg) {
  if (!errorMsg) return false;
  return errorMsg.includes('Idle timeout:') || errorMsg.includes('Total timeout:');
}

// Exported for testing
export { _isTimeoutError, _getTimeoutMs, MAX_RETRIES, DEFAULT_TIMEOUT_MS };
