import { runTask, runTaskDryRun } from './cycle/task-runner.js';
import { validateConfig, config } from './config.js';
import { logger } from './utils/logger.js';
import { eventBus, EVENT_TYPES, AGENT_STATES } from './events/event-bus.js';
import { komodoState, PHASES, EXECUTION_STATES } from './state/komodo-state.js';
import { KomodoWsServer } from './server/ws-server.js';
import { checkpointManager } from './state/checkpoint-manager.js';

// Re-export para que consumidores externos puedan suscribirse
export { eventBus, EVENT_TYPES, AGENT_STATES, KomodoWsServer, komodoState, PHASES, EXECUTION_STATES, checkpointManager };

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

  // Iniciar WebSocket server para dashboard en tiempo real
  const wsServer = new KomodoWsServer();
  try {
    await wsServer.start();
  } catch (err) {
    logger.warn(`No se pudo iniciar WS server: ${err.message}`, 'KOMODO');
  }

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

  // Stop checkpoint manager
  checkpointManager.stop();

  // Set state to stopped when loop ends (unless already paused by rate limit)
  if (komodoState.executionState !== EXECUTION_STATES.PAUSED) {
    komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
  }

  // Detener WebSocket server
  await wsServer.stop();

  // Resumen final
  logger.taskHeader('RESUMEN FINAL');
  logger.info(`Tareas completadas: ${tasksCompleted}`, 'KOMODO');
  if (tasksFailed > 0) {
    logger.warn(`Tareas fallidas: ${tasksFailed}`, 'KOMODO');
  }

  return { tasksCompleted, tasksFailed, results };
}
