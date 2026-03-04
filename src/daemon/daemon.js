import { runTask } from '../cycle/task-runner.js';
import { fetchProjectTasks, filterBlockedTasks } from '../agents/planner.js';
import { validateConfig, config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, PHASES, EXECUTION_STATES } from '../state/komodo-state.js';
import { KomodoWsServer } from '../server/ws-server.js';
import { checkpointManager } from '../state/checkpoint-manager.js';
import { checkForPendingCheckpoints } from '../orchestrator.js';

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

  // Start WebSocket server
  const wsServer = new KomodoWsServer();
  try {
    await wsServer.start();
  } catch (err) {
    logger.warn(`No se pudo iniciar WS server: ${err.message}`, AGENT);
  }

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

  // Main daemon loop
  while (true) {
    // Check for stop signal
    if (komodoState.executionState === EXECUTION_STATES.STOPPED) {
      logger.info('Stop requested. Shutting down daemon.', AGENT);
      break;
    }

    // Check max tasks limit
    if (maxTasks > 0 && tasksCompleted >= maxTasks) {
      logger.info(`Max tasks per session reached (${maxTasks}). Stopping daemon.`, AGENT);
      break;
    }

    // Check if there are to-do tasks available
    const hasTasks = await _hasEligibleTasks(projectId);

    if (!hasTasks) {
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
  checkpointManager.stop();
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
