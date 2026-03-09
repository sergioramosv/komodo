import { runTask } from '../cycle/task-runner.js';
import { fetchProjectTasks, filterBlockedTasks } from '../agents/planner.js';
import { validateConfig, config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, PHASES, EXECUTION_STATES } from '../state/komodo-state.js';
import { KomodoWsServer } from '../server/ws-server.js';
import { checkpointManager } from '../state/checkpoint-manager.js';
import { checkForPendingCheckpoints } from '../orchestrator.js';
import { checkSchedule, formatMinutes } from '../scheduler/scheduler.js';
import { shutdownManager } from '../shutdown/shutdown-manager.js';
import { runDependencyCheck } from '../auto-improve/dependency-checker.js';
import { startWebhookOutgoing, stopWebhookOutgoing } from '../integrations/webhook-outgoing.js';
import { budgetManager } from '../cost/budget-manager.js';

const AGENT = 'DAEMON';

/**
 * Runs Komodo in daemon/watch mode: continuously polls the backlog
 * and executes tasks as they appear.
 *
 * @param {string} projectId - ID del proyecto
 * @param {Object} [options]
 * @param {string} [options.cwd] - Directorio del repositorio
 * @returns {Promise<{ tasksCompleted: number, tasksFailed: number, results: Object[] }>}
 */
export async function watch(projectId, options = {}) {
  const { cwd } = options;

  // Validate config
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Errores de configuración:', AGENT);
    errors.forEach(e => logger.error(`  - ${e}`, AGENT));
    return { tasksCompleted: 0, tasksFailed: 0, results: [] };
  }

  const pollInterval = config.daemonPollInterval;
  const maxTasks = config.daemonMaxTasksPerSession; // 0 = unlimited

  logger.taskHeader('KOMODO DAEMON — Watch Mode');
  logger.info(`Proyecto: ${projectId}`, AGENT);
  logger.info(`Poll interval: ${pollInterval}s`, AGENT);
  logger.info(`Max tasks per session: ${maxTasks === 0 ? 'unlimited' : maxTasks}`, AGENT);
  if (config.schedule) {
    logger.info(`Schedule: ${config.schedule}${config.scheduleTimezone ? ` (${config.scheduleTimezone})` : ''}`, AGENT);
  } else {
    logger.info('Schedule: 24/7 (no restrictions)', AGENT);
  }

  // Reset global state
  komodoState.updatePhase(PHASES.IDLE, {
    currentTask: null,
    currentPR: null,
    reviewCycle: 0,
    tasksCompleted: 0,
  });
  komodoState.setExecutionState(EXECUTION_STATES.DAEMON_RUNNING);

  // Start checkpoint manager
  checkpointManager.start();

  // Start budget manager
  budgetManager.start({ projectId });

  // Start WebSocket server
  const wsServer = new KomodoWsServer();
  try {
    await wsServer.start();
  } catch (err) {
    logger.warn(`No se pudo iniciar WS server: ${err.message}`, AGENT);
  }

  // Start webhook outgoing (forwards events to external URLs if configured)
  startWebhookOutgoing();

  // Register graceful shutdown handlers (SIGINT/SIGTERM)
  shutdownManager.register({ wsServer });

  // Emit daemon:started
  eventBus.emitEvent(EVENT_TYPES.DAEMON_STARTED, {
    metadata: { projectId, pollInterval, maxTasks },
  });

  // Check for pending checkpoints before starting
  try {
    const checkpointResult = await checkForPendingCheckpoints({ cwd, autoResume: true });
    if (checkpointResult.resumed) {
      const r = checkpointResult.result;
      logger.info(`Reanudación ${r.success ? 'exitosa' : 'fallida'}`, AGENT);
    }
  } catch (err) {
    logger.warn(`Error checking checkpoints: ${err.message}`, AGENT);
  }

  const results = [];
  let tasksCompleted = 0;
  let tasksFailed = 0;
  let lastDepCheck = 0; // timestamp of last dependency check

  // Main daemon loop
  while (true) {
    // Check for stop signal
    if (komodoState.executionState === EXECUTION_STATES.STOPPED) {
      logger.info('Stop requested. Shutting down daemon.', AGENT);
      break;
    }

    // Check budget pause — do not execute new agents while budget is exceeded
    if (komodoState.executionState === EXECUTION_STATES.BUDGET_PAUSED) {
      logger.warn('Budget paused. Waiting for budget period reset...', AGENT);
      const shouldContinue = await _waitForBudgetReset(30);
      if (!shouldContinue) break;
      komodoState.setExecutionState(EXECUTION_STATES.DAEMON_RUNNING);
      logger.info('Budget reset. Resuming execution.', AGENT);
      continue;
    }

    // Check schedule window
    const scheduleCheck = checkSchedule();
    if (!scheduleCheck.allowed) {
      komodoState.setExecutionState(EXECUTION_STATES.SCHEDULER_WAITING);
      const next = scheduleCheck.nextWindow;
      eventBus.emitEvent(EVENT_TYPES.SCHEDULER_WAITING, {
        metadata: {
          nextWindowStart: next?.nextWindowStart || null,
          minutesUntil: next?.minutesUntil || null,
        },
      });

      // Wait until next window opens (check every 30s)
      const shouldContinue = await _waitForScheduleWindow(30);
      if (!shouldContinue) break;

      komodoState.setExecutionState(EXECUTION_STATES.DAEMON_RUNNING);
      eventBus.emitEvent(EVENT_TYPES.SCHEDULER_RESUMED, {
        metadata: { tasksCompleted },
      });
      logger.info('Schedule window opened. Resuming execution.', AGENT);
      continue;
    }

    // Check max tasks limit
    if (maxTasks > 0 && tasksCompleted >= maxTasks) {
      logger.info(`Max tasks per session reached (${maxTasks}). Stopping daemon.`, AGENT);
      break;
    }

    // Check if there are to-do tasks available
    const hasTasks = await _hasEligibleTasks(projectId);

    if (!hasTasks) {
      // Run periodic dependency check during idle
      const depCheckIntervalMs = config.depCheckIntervalHours * 60 * 60 * 1000;
      if (config.depCheckEnabled && (Date.now() - lastDepCheck) >= depCheckIntervalMs) {
        try {
          await runDependencyCheck({ projectId, cwd });
        } catch (err) {
          logger.warn(`Dependency check failed (non-blocking): ${err.message}`, AGENT);
        }
        lastDepCheck = Date.now();
      }

      // Enter idle mode
      komodoState.setExecutionState(EXECUTION_STATES.DAEMON_IDLE);
      eventBus.emitEvent(EVENT_TYPES.DAEMON_IDLE, {
        metadata: { nextPollIn: pollInterval, tasksCompleted },
      });
      logger.info(`Backlog vacío. Idle — siguiente poll en ${pollInterval}s...`, AGENT);

      // Poll loop: wait and check again
      const shouldContinue = await _pollUntilTaskOrStop(projectId, pollInterval);
      if (!shouldContinue) {
        break;
      }

      // Task detected — emit event and continue to execution
      komodoState.setExecutionState(EXECUTION_STATES.DAEMON_RUNNING);
      eventBus.emitEvent(EVENT_TYPES.DAEMON_TASK_DETECTED, {
        metadata: { tasksCompleted },
      });
      logger.info('Tarea detectada en backlog. Ejecutando...', AGENT);
    }

    // Execute a task
    try {
      komodoState.setExecutionState(EXECUTION_STATES.DAEMON_RUNNING);
      const result = await runTask(projectId, cwd);
      results.push(result);

      if (!result.taskId) {
        // Backlog empty (planner returned no tasks) — go to idle
        continue;
      }

      if (result.success) {
        tasksCompleted++;
        komodoState.updatePhase(PHASES.IDLE, { tasksCompleted });
        logger.success(`Tarea "${result.taskTitle}" completada (total: ${tasksCompleted})`, AGENT);
      } else {
        tasksFailed++;
        komodoState.updatePhase(PHASES.IDLE);
        logger.error(`Tarea "${result.taskTitle}" falló: ${result.error}`, AGENT);
      }
    } catch (err) {
      tasksFailed++;
      logger.error(`Error inesperado: ${err.message}`, AGENT);
      results.push({ success: false, error: err.message });
    }
  }

  // Cleanup
  stopWebhookOutgoing();
  shutdownManager.unregister();
  checkpointManager.stop();
  budgetManager.stop();
  komodoState.setExecutionState(EXECUTION_STATES.STOPPED);

  eventBus.emitEvent(EVENT_TYPES.DAEMON_STOPPED, {
    metadata: { tasksCompleted, tasksFailed },
  });

  await wsServer.stop();

  logger.taskHeader('DAEMON STOPPED');
  logger.info(`Tareas completadas: ${tasksCompleted}`, AGENT);
  if (tasksFailed > 0) {
    logger.warn(`Tareas fallidas: ${tasksFailed}`, AGENT);
  }

  return { tasksCompleted, tasksFailed, results };
}

/**
 * Checks if there are eligible to-do tasks in the backlog.
 *
 * @param {string} projectId
 * @returns {Promise<boolean>}
 */
async function _hasEligibleTasks(projectId) {
  try {
    const allTasks = await fetchProjectTasks(projectId);
    const todoTasks = allTasks.filter(t => t.status === 'to-do');

    if (todoTasks.length === 0) return false;

    const { eligible } = filterBlockedTasks(todoTasks, allTasks);
    return eligible.length > 0;
  } catch (err) {
    logger.warn(`Error checking backlog: ${err.message}`, AGENT);
    return false;
  }
}

/**
 * Polls the backlog until a task appears or a stop is requested.
 * Returns true if a task was found, false if stopped.
 *
 * @param {string} projectId
 * @param {number} intervalSeconds
 * @returns {Promise<boolean>}
 */
async function _pollUntilTaskOrStop(projectId, intervalSeconds) {
  while (true) {
    // Wait for the poll interval
    await _sleep(intervalSeconds * 1000);

    // Check for stop signal
    if (komodoState.executionState === EXECUTION_STATES.STOPPED) {
      return false;
    }

    // Check for tasks
    const hasTasks = await _hasEligibleTasks(projectId);
    if (hasTasks) {
      return true;
    }

    logger.info(`Backlog vacío. Siguiente poll en ${intervalSeconds}s...`, AGENT);
  }
}

/**
 * Waits until the current time enters a schedule window or the daemon is stopped.
 * Checks every `intervalSeconds` seconds.
 *
 * @param {number} intervalSeconds - How often to check (default: 30)
 * @returns {Promise<boolean>} true if a window opened, false if stopped
 */
async function _waitForScheduleWindow(intervalSeconds = 30) {
  while (true) {
    await _sleep(intervalSeconds * 1000);

    if (komodoState.executionState === EXECUTION_STATES.STOPPED) {
      return false;
    }

    const { allowed } = checkSchedule();
    if (allowed) {
      return true;
    }
  }
}

/**
 * Waits until the budget period resets (state leaves BUDGET_PAUSED) or the daemon is stopped.
 * Checks every `intervalSeconds` seconds.
 *
 * @param {number} intervalSeconds - How often to check (default: 30)
 * @returns {Promise<boolean>} true if budget was reset, false if stopped
 */
async function _waitForBudgetReset(intervalSeconds = 30) {
  while (true) {
    await _sleep(intervalSeconds * 1000);

    if (komodoState.executionState === EXECUTION_STATES.STOPPED) {
      return false;
    }

    if (komodoState.executionState !== EXECUTION_STATES.BUDGET_PAUSED) {
      return true;
    }
  }
}

/**
 * Sleeps for the given ms, but can be interrupted by a stop signal.
 * Checks every second if the daemon should stop.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise(resolve => {
    const checkInterval = 1000;
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += checkInterval;
      if (elapsed >= ms || komodoState.executionState === EXECUTION_STATES.STOPPED) {
        clearInterval(timer);
        resolve();
      }
    }, checkInterval);
  });
}
