import { runTask, runTaskDryRun, resumeTask } from './cycle/task-runner.js';
import { createInterface } from 'readline';
import { validateConfig, config } from './config.js';
import { logger } from './utils/logger.js';
import { eventBus, EVENT_TYPES, AGENT_STATES } from './events/event-bus.js';
import { komodoState, PHASES, EXECUTION_STATES } from './state/komodo-state.js';
import { KomodoWsServer } from './server/ws-server.js';
import { startApiServerIfEnabled } from './server/api-server.js';
import { checkpointManager } from './state/checkpoint-manager.js';

import { fallbackManager } from './agents/fallback-manager.js';
import { shutdownManager } from './shutdown/shutdown-manager.js';
import { pluginLoader } from './plugins/plugin-loader.js';
import { heartbeatMonitor } from './heartbeat/heartbeat-monitor.js';

// Daemon / watch mode
export { watch } from './daemon/daemon.js';

// Re-export para que consumidores externos puedan suscribirse
export { eventBus, EVENT_TYPES, AGENT_STATES, KomodoWsServer, komodoState, PHASES, EXECUTION_STATES, checkpointManager, fallbackManager, shutdownManager };

/**
 * Ejecuta N tareas del backlog de un proyecto.
 *
 * @param {string} projectId - ID del proyecto
 * @param {Object} [options]
 * @param {number} [options.tasks=1] - Número de tareas a ejecutar (0 = todas)
 * @param {string} [options.cwd] - Directorio del repositorio
 * @param {boolean} [options.dryRun=false] - Solo mostrar qué haría sin ejecutar
 * @returns {Promise<{
 *   tasksCompleted: number,
 *   tasksFailed: number,
 *   results: Object[]
 * }>}
 */
export async function run(projectId, options = {}) {
  const { tasks: maxTasks = 1, cwd, dryRun = false } = options;
  const continuous = maxTasks === 0;

  // Validar configuración
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Errores de configuración:', 'KOMODO');
    errors.forEach(e => logger.error(`  - ${e}`, 'KOMODO'));
    return { tasksCompleted: 0, tasksFailed: 0, results: [] };
  }

  // ═══════════════════════════════════════════
  // DRY-RUN
  // ═══════════════════════════════════════════
  if (dryRun) {
    logger.taskHeader('KOMODO - Modo: DRY-RUN (simulación)');
    logger.info(`Proyecto: ${projectId}`, 'KOMODO');

    const result = await runTaskDryRun(projectId);
    return {
      tasksCompleted: 0,
      tasksFailed: 0,
      results: [result],
    };
  }

  // ═══════════════════════════════════════════
  // EJECUCIÓN REAL
  // ═══════════════════════════════════════════
  const mode = continuous ? 'continuo (hasta vaciar backlog)' : `${maxTasks} tarea(s)`;
  logger.taskHeader(`KOMODO - Modo: ${mode}`);
  logger.info(`Proyecto: ${projectId}`, 'KOMODO');
  logger.info(`Auto-merge: ${config.autoMerge ? 'sí' : 'no (manual)'}`, 'KOMODO');
  logger.info(`Max review cycles: ${config.maxReviewCycles}`, 'KOMODO');

  // Load plugins once at startup
  try {
    await pluginLoader.load();
  } catch (err) {
    logger.warn(`Failed to load plugins: ${err.message}`, 'KOMODO');
  }

  // Reset global state for fresh run
  komodoState.updatePhase(PHASES.IDLE, {
    currentTask: null,
    currentPR: null,
    reviewCycle: 0,
    tasksCompleted: 0,
  });
  komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

  // Start checkpoint manager for rate limit recovery
  checkpointManager.start();

  // Start heartbeat monitor for auto-recovery from rate limits
  heartbeatMonitor.start();

  // Iniciar WebSocket server para dashboard en tiempo real
  const wsServer = new KomodoWsServer();
  try {
    await wsServer.start();
  } catch (err) {
    logger.warn(`No se pudo iniciar WS server: ${err.message}`, 'KOMODO');
  }

  // Iniciar API server
  const apiServer = await startApiServerIfEnabled({
    onRun: (tasks) => run(projectId, { ...options, tasks })
  });

  // Register graceful shutdown handlers (SIGINT/SIGTERM)
  shutdownManager.register({ wsServer, apiServer });

  const results = [];
  let tasksCompleted = 0;
  let tasksFailed = 0;
  let taskNumber = 0;

  while (true) {
    taskNumber++;

    // Check for stop signal before starting a new task
    if (komodoState.isStopRequested()) {
      logger.info('Stop requested. Stopping orchestrator.', 'KOMODO');
      break;
    }

    // Check for pause signal between tasks
    if (komodoState.isPauseRequested()) {
      logger.info('Pause requested. Pausing after completing last task.', 'KOMODO');
      break;
    }

    // ¿Hemos llegado al límite de tareas?
    if (!continuous && taskNumber > maxTasks) break;

    logger.taskHeader(`TAREA ${taskNumber}${continuous ? '' : `/${maxTasks}`}`);

    try {
      const result = await runTask(projectId, cwd);
      results.push(result);

      // No hay más tareas en el backlog
      if (!result.taskId) {
        logger.info('Backlog vacío. Parando.', 'KOMODO');
        break;
      }

      if (result.success) {
        tasksCompleted++;
        komodoState.updatePhase(PHASES.IDLE, { tasksCompleted });
        logger.success(`Tarea "${result.taskTitle}" completada`, 'KOMODO');
      } else {
        tasksFailed++;
        komodoState.updatePhase(PHASES.IDLE);
        logger.error(`Tarea "${result.taskTitle}" falló: ${result.error}`, 'KOMODO');

        // En modo no-continuo, parar si falla
        if (!continuous) break;
      }
    } catch (err) {
      tasksFailed++;
      logger.error(`Error inesperado en tarea ${taskNumber}: ${err.message}`, 'KOMODO');
      results.push({ success: false, error: err.message });

      if (!continuous) break;
    }
  }

  // Unregister shutdown handlers (cleanup handled manually below)
  shutdownManager.unregister();

  // Stop checkpoint manager and heartbeat monitor
  checkpointManager.stop();
  heartbeatMonitor.stop();

  // Set state to stopped when loop ends (unless already paused by rate limit)
  if (komodoState.executionState !== EXECUTION_STATES.PAUSED) {
    komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
  }

  // Detener servidores
  if (apiServer) await apiServer.stop();
  await wsServer.stop();

  // Resumen final
  logger.taskHeader('RESUMEN FINAL');
  logger.info(`Tareas completadas: ${tasksCompleted}`, 'KOMODO');
  if (tasksFailed > 0) {
    logger.warn(`Tareas fallidas: ${tasksFailed}`, 'KOMODO');
  }

  return { tasksCompleted, tasksFailed, results };
}

/**
 * Ask the user a yes/no question via stdin.
 *
 * @param {string} question - The question to ask
 * @returns {Promise<boolean>} true if user answered 's' or 'y'
 */
function askUser(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 's' || normalized === 'y' || normalized === 'si' || normalized === 'yes');
    });
  });
}

/**
 * Retrieves the latest valid checkpoint, discarding invalid ones.
 *
 * @returns {Promise<{ filepath: string, checkpoint: Object } | null>}
 * @private
 */
async function _getLatestValidCheckpoint() {
  const pendingCheckpoints = await checkpointManager.listPendingCheckpoints();
  if (pendingCheckpoints.length === 0) return null;

  const { filepath, checkpoint } = pendingCheckpoints[0];

  const validation = checkpointManager.validateCheckpoint(checkpoint);
  if (!validation.valid) {
    logger.warn(`Checkpoint descartado: ${validation.reason}`, 'KOMODO');
    await checkpointManager.deleteCheckpoint(filepath);
    return null;
  }

  return { filepath, checkpoint };
}

/**
 * Check for pending checkpoints and optionally resume.
 *
 * Called at the start of `komodo run` to detect paused sessions.
 * If CHECKPOINT_AUTO_RESUME=true, resumes automatically.
 * Otherwise, prompts the user.
 *
 * @param {Object} [options]
 * @param {string} [options.cwd] - Directorio del repositorio
 * @param {boolean} [options.autoResume] - Force auto-resume without prompting
 * @returns {Promise<{ resumed: boolean, result?: Object }>}
 */
export async function checkForPendingCheckpoints(options = {}) {
  const found = await _getLatestValidCheckpoint();
  if (!found) return { resumed: false };

  const { filepath, checkpoint } = found;

  const autoResume = options.autoResume || process.env.CHECKPOINT_AUTO_RESUME === 'true';

  if (!autoResume) {
    logger.taskHeader('CHECKPOINT DETECTADO');
    logger.info(`Tarea: "${checkpoint.taskTitle}" (${checkpoint.taskId})`, 'KOMODO');
    logger.info(`Paso: ${checkpoint.flowStep}`, 'KOMODO');
    logger.info(`Branch: ${checkpoint.branchName || '(none)'}`, 'KOMODO');
    logger.info(`PR: ${checkpoint.prNumber || '(none)'}`, 'KOMODO');
    logger.info(`Pausado: ${checkpoint.timestamp}`, 'KOMODO');

    const shouldResume = await askUser(
      `Se encontró una sesión pausada para la tarea "${checkpoint.taskTitle}" en el paso "${checkpoint.flowStep}". ¿Reanudar? (s/n) `
    );

    if (!shouldResume) {
      logger.info('Checkpoint ignorado. Continuando con ejecución normal.', 'KOMODO');
      return { resumed: false };
    }
  } else {
    logger.info(`Auto-resume: reanudando tarea "${checkpoint.taskTitle}" desde paso "${checkpoint.flowStep}"`, 'KOMODO');
  }

  // Resume the task
  const result = await _executeResume(checkpoint, filepath, options.cwd);
  return { resumed: true, result };
}

/**
 * Resume execution from a specific checkpoint (explicit resume command).
 *
 * @param {Object} [options]
 * @param {string} [options.cwd] - Directorio del repositorio
 * @returns {Promise<{
 *   tasksCompleted: number,
 *   tasksFailed: number,
 *   results: Object[]
 * }>}
 */
export async function resume(options = {}) {
  const { cwd } = options;

  // Validar configuración
  const errors = validateConfig();
  if (errors.length > 0) {
    logger.error('Errores de configuración:', 'KOMODO');
    errors.forEach(e => logger.error(`  - ${e}`, 'KOMODO'));
    return { tasksCompleted: 0, tasksFailed: 0, results: [] };
  }

  const found = await _getLatestValidCheckpoint();
  if (!found) {
    logger.info('No hay checkpoints pendientes. Nada que reanudar.', 'KOMODO');
    return { tasksCompleted: 0, tasksFailed: 0, results: [] };
  }

  const { filepath, checkpoint } = found;

  logger.taskHeader('KOMODO RESUME');
  logger.info(`Reanudando tarea: "${checkpoint.taskTitle}"`, 'KOMODO');
  logger.info(`Paso: ${checkpoint.flowStep}`, 'KOMODO');

  const result = await _executeResume(checkpoint, filepath, cwd);

  return {
    tasksCompleted: result.success ? 1 : 0,
    tasksFailed: result.success ? 0 : 1,
    results: [result],
  };
}

/**
 * Internal: execute the actual resume flow.
 *
 * @param {Object} checkpoint - Checkpoint data
 * @param {string} filepath - Path to checkpoint file
 * @param {string} [cwd] - Working directory
 * @returns {Promise<Object>} Task result
 * @private
 */
async function _executeResume(checkpoint, filepath, cwd) {
  // Reset state for the resume
  komodoState.updatePhase(PHASES.IDLE, {
    currentTask: null,
    currentPR: null,
    reviewCycle: 0,
  });
  komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

  // Start checkpoint manager and heartbeat for new rate limits during resume
  checkpointManager.start();
  heartbeatMonitor.start();

  // Start WebSocket server
  const wsServer = new KomodoWsServer();
  try {
    await wsServer.start();
  } catch (err) {
    logger.warn(`No se pudo iniciar WS server: ${err.message}`, 'KOMODO');
  }

  // Iniciar API server
  const apiServer = await startApiServerIfEnabled();

  // Register graceful shutdown handlers (SIGINT/SIGTERM)
  shutdownManager.register({ wsServer, apiServer });

  try {
    const result = await resumeTask(checkpoint, cwd);

    // On success, delete the checkpoint
    if (result.success) {
      await checkpointManager.deleteCheckpoint(filepath);
      logger.success('Checkpoint eliminado tras reanudación exitosa.', 'KOMODO');

      // Clean up remaining checkpoints for same task
      const remaining = await checkpointManager.listPendingCheckpoints();
      for (const { filepath: fp, checkpoint: cp } of remaining) {
        if (cp.taskId === checkpoint.taskId) {
          await checkpointManager.deleteCheckpoint(fp);
        }
      }
    }

    return result;
  } finally {
    shutdownManager.unregister();
    checkpointManager.stop();
    heartbeatMonitor.stop();

    if (komodoState.executionState !== EXECUTION_STATES.PAUSED) {
      komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
    }

    if (apiServer) await apiServer.stop();
    await wsServer.stop();

    logger.taskHeader('RESUMEN FINAL');
  }
}
