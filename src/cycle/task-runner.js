import { pickNextTask } from '../agents/planner.js';
import { implementTask } from '../agents/coder.js';
import { reviewLoop } from './review-loop.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { runGh } from '../../skills/github-mcp/src/gh-cli.js';
import { runAgent } from '../agents/base-agent.js';
import { bus, EventTypes, AgentStates } from '../events/event-bus.js';

/**
 * Extrae owner/repo de una URL de GitHub.
 */
function extractOwnerRepo(repoUrl) {
  if (!repoUrl) return '';
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1].replace(/\.git$/, '') : repoUrl;
}

/**
 * Mergea una PR usando gh CLI directamente (no necesita agente IA).
 */
function mergePR(repo, prNumber) {
  logger.info(`Mergeando PR #${prNumber}...`, 'KOMODO');
  runGh([
    'pr', 'merge', String(prNumber),
    '--repo', repo,
    '--squash',
    '--delete-branch',
  ]);
  logger.success(`PR #${prNumber} mergeada (squash + branch eliminada)`, 'KOMODO');
}

/**
 * Cierra una PR sin mergear con un comentario explicativo.
 */
function closePR(repo, prNumber, reason) {
  logger.info(`Cerrando PR #${prNumber}...`, 'KOMODO');
  try {
    runGh([
      'pr', 'close', String(prNumber),
      '--repo', repo,
      '--comment', `Cerrada automáticamente por Komodo: ${reason}`,
      '--delete-branch',
    ]);
    logger.info(`PR #${prNumber} cerrada`, 'KOMODO');
  } catch (err) {
    logger.warn(`No se pudo cerrar PR #${prNumber}: ${err.message}`, 'KOMODO');
  }
}

/**
 * Cambia el estado de una tarea usando un agente mini.
 */
async function changeTaskStatus(taskId, newStatus) {
  logger.info(`Marcando tarea ${taskId} como ${newStatus}...`, 'KOMODO');

  await runAgent({
    name: 'KOMODO',
    systemPrompt: 'Eres un asistente que actualiza el estado de tareas. Cambia el estado de la tarea indicada y responde con JSON: { "updated": true }.',
    userPrompt: `Usa change_task_status para cambiar la tarea "${taskId}" a estado "${newStatus}". Responde con { "updated": true }.`,
    mcpServerNames: ['planning-task-mcp'],
    maxTurns: 5,
  });
}

/**
 * Registra el resultado de la review en memoria.
 */
async function recordOutcome(passed, cycles) {
  await runAgent({
    name: 'KOMODO',
    systemPrompt: 'Registra el resultado de una review en memoria. Responde con { "recorded": true }.',
    userPrompt: `Usa record_review_outcome con passed=${passed} y cycles=${cycles}. Responde con { "recorded": true }.`,
    mcpServerNames: ['memory-mcp'],
    maxTurns: 5,
  });
}

/**
 * Rollback: devuelve la tarea a to-do cuando algo falla después del Planner.
 */
async function rollbackTask(taskId) {
  try {
    await changeTaskStatus(taskId, 'to-do');
    logger.info(`Tarea ${taskId} devuelta a to-do`, 'KOMODO');
  } catch (err) {
    logger.warn(`No se pudo hacer rollback de tarea ${taskId}: ${err.message}`, 'KOMODO');
  }
}

// ═══════════════════════════════════════════
// DRY-RUN: solo muestra qué haría
// ═══════════════════════════════════════════

/**
 * Modo dry-run: Planner elige tarea pero NO cambia estado.
 * Solo muestra qué tarea ejecutaría.
 */
export async function runTaskDryRun(projectId) {
  const startTime = Date.now();

  logger.logStep(1, 1, 'Planner analizando backlog (dry-run)...', 'KOMODO');

  const result = await runAgent({
    name: 'PLANNER',
    systemPrompt: getDryRunPlannerPrompt(projectId),
    userPrompt: `Analiza el backlog del proyecto "${projectId}" y dime qué tarea elegirías. NO cambies ningún estado. Solo reporta.`,
    mcpServerNames: ['planning-task-mcp'],
    maxTurns: 10,
  });

  const duration = (Date.now() - startTime) / 1000;

  if (!result.success || !result.result) {
    return {
      success: false,
      task: null,
      totalDuration: duration,
      error: result.error || 'Planner no devolvió resultado',
    };
  }

  const data = result.result;

  if (data.taskId === null) {
    logger.info('No hay tareas pendientes en el backlog.', 'KOMODO');
    return { success: true, task: null, totalDuration: duration };
  }

  logger.taskHeader('DRY-RUN — Resultado');
  logger.info(`Tarea: "${data.title}"`, 'KOMODO');
  logger.info(`ID: ${data.taskId}`, 'KOMODO');
  logger.info(`Branch: ${data.branchName || '(no generado)'}`, 'KOMODO');
  logger.info(`Puntos: biz=${data.bizPoints || '?'} dev=${data.devPoints || '?'}`, 'KOMODO');
  logger.info(`Duración: ${duration.toFixed(1)}s`, 'KOMODO');

  return {
    success: true,
    task: data,
    totalDuration: duration,
  };
}

function getDryRunPlannerPrompt(projectId) {
  return `Eres el PLANNER de Komodo en modo DRY-RUN (simulación).

## Tu rol
Analiza el backlog y reporta qué tarea elegirías, pero NO cambies ningún estado.

## Instrucciones
1. Llama a list_sprints({ projectId: "${projectId}", status: "active" }) para ver el sprint activo
2. Llama a list_tasks({ projectId: "${projectId}", status: "to-do" }) para ver tareas pendientes
3. Analiza: mayor prioridad (bizPoints/devPoints), dependencias, sprint activo
4. NO llames a change_task_status — esto es solo simulación

## Respuesta
Responde con JSON:
{
  "taskId": "id",
  "title": "título",
  "branchName": "feature/task-xxx-slug",
  "devPoints": N,
  "bizPoints": N
}

Si no hay tareas: { "taskId": null, "message": "No hay tareas pendientes" }`;
}

// ═══════════════════════════════════════════
// RUN TASK: flujo completo con recovery
// ═══════════════════════════════════════════

/**
 * Ejecuta el flujo completo de 1 tarea:
 * Planner → Coder → ReviewLoop → (Merge) → Update task
 *
 * Con error recovery: si falla a mitad, limpia PRs y devuelve tarea a to-do.
 *
 * @param {string} projectId
 * @param {string} [cwd] - Directorio del repositorio
 * @returns {Promise<{
 *   success: boolean,
 *   taskId: string | null,
 *   taskTitle: string | null,
 *   prNumber: number | null,
 *   approved: boolean,
 *   merged: boolean,
 *   reviewCycles: number,
 *   totalDuration: number,
 *   error?: string
 * }>}
 */
export async function runTask(projectId, cwd) {
  const startTime = Date.now();
  let taskSpec = null;
  let prNumber = null;
  let repo = '';

  try {
    // ═══════════════════════════════════════════
    // PASO 1: PLANNER — Elegir tarea
    // ═══════════════════════════════════════════
    logger.logStep(1, 4, 'Planner eligiendo tarea...', 'KOMODO');
    bus.agentStateChange('PLANNER', AgentStates.WORKING);

    const plannerResult = await pickNextTask(projectId);
    bus.agentStateChange('PLANNER', AgentStates.IDLE);

    if (!plannerResult.success) {
      return makeResult({ success: false, startTime, error: plannerResult.error });
    }

    // No hay tareas pendientes
    if (!plannerResult.task) {
      logger.info('No hay tareas pendientes en el backlog.', 'KOMODO');
      return makeResult({ success: true, startTime });
    }

    taskSpec = plannerResult.task;
    repo = extractOwnerRepo(taskSpec.repoUrl);
    logger.info(`Tarea: "${taskSpec.title}" | Branch: ${taskSpec.branchName} | Repo: ${repo}`, 'KOMODO');

    bus.emitEvent(EventTypes.TASK_STARTED, {
      agentName: 'KOMODO',
      taskId: taskSpec.taskId,
      taskTitle: taskSpec.title,
      branchName: taskSpec.branchName,
      metadata: { repo },
    });

    // ═══════════════════════════════════════════
    // PASO 2: CODER — Implementar
    // ═══════════════════════════════════════════
    logger.logStep(2, 4, 'Coder implementando...', 'KOMODO');
    bus.agentStateChange('CODER', AgentStates.WORKING);

    const coderResult = await implementTask(taskSpec, cwd);
    bus.agentStateChange('CODER', AgentStates.IDLE);

    if (!coderResult.success) {
      // Recovery: devolver tarea a to-do
      await rollbackTask(taskSpec.taskId);
      return makeResult({
        success: false, taskSpec, startTime,
        error: coderResult.error,
      });
    }

    prNumber = coderResult.pr.prNumber;
    logger.info(`PR #${prNumber} creada`, 'KOMODO');

    bus.emitEvent(EventTypes.PR_CREATED, {
      agentName: 'CODER',
      taskId: taskSpec.taskId,
      prNumber,
      metadata: { repo, branchName: taskSpec.branchName },
    });

    // ═══════════════════════════════════════════
    // PASO 3: REVIEW LOOP — Reviewer ↔ Coder
    // ═══════════════════════════════════════════
    logger.logStep(3, 4, 'Review loop...', 'KOMODO');

    const reviewResult = await reviewLoop({ prNumber, repo, taskSpec, cwd });

    // Registrar outcome en memoria (best effort)
    try {
      await recordOutcome(reviewResult.approved, reviewResult.cycles);
    } catch (err) {
      logger.warn(`No se pudo registrar outcome en memoria: ${err.message}`, 'KOMODO');
    }

    if (!reviewResult.approved) {
      // Recovery: cerrar PR huérfana + devolver tarea a to-do
      closePR(repo, prNumber, reviewResult.error || 'Review no aprobada');
      await rollbackTask(taskSpec.taskId);
      return makeResult({
        success: false, taskSpec, prNumber, startTime,
        reviewCycles: reviewResult.cycles,
        error: reviewResult.error,
      });
    }

    // ═══════════════════════════════════════════
    // PASO 4: MERGE + UPDATE TASK
    // ═══════════════════════════════════════════
    logger.logStep(4, 4, 'Finalizando...', 'KOMODO');

    let merged = false;

    if (config.autoMerge) {
      try {
        mergePR(repo, prNumber);
        merged = true;

        bus.emitEvent(EventTypes.PR_MERGED, {
          agentName: 'KOMODO',
          taskId: taskSpec.taskId,
          prNumber,
          metadata: { repo },
        });
      } catch (err) {
        logger.error(`Error al mergear PR #${prNumber}: ${err.message}`, 'KOMODO');
      }

      try {
        await changeTaskStatus(taskSpec.taskId, 'done');
      } catch (err) {
        logger.warn(`No se pudo actualizar tarea a done: ${err.message}`, 'KOMODO');
      }
    } else {
      logger.info('AUTO_MERGE=false → PR aprobada, esperando merge manual.', 'KOMODO');

      try {
        await changeTaskStatus(taskSpec.taskId, 'to-validate');
      } catch (err) {
        logger.warn(`No se pudo actualizar tarea a to-validate: ${err.message}`, 'KOMODO');
      }
    }

    const totalDuration = (Date.now() - startTime) / 1000;

    bus.emitEvent(EventTypes.TASK_COMPLETED, {
      agentName: 'KOMODO',
      taskId: taskSpec.taskId,
      taskTitle: taskSpec.title,
      metadata: {
        prNumber,
        approved: true,
        merged,
        reviewCycles: reviewResult.cycles,
        totalDuration,
      },
    });

    // Resumen final
    logger.taskHeader('RESUMEN');
    logger.info(`Tarea: "${taskSpec.title}"`, 'KOMODO');
    logger.info(`PR: #${prNumber}`, 'KOMODO');
    logger.info(`Review cycles: ${reviewResult.cycles}`, 'KOMODO');
    logger.info(`Merged: ${merged ? 'sí' : 'no (manual)'}`, 'KOMODO');
    logger.info(`Duración total: ${totalDuration.toFixed(1)}s`, 'KOMODO');

    return {
      success: true,
      taskId: taskSpec.taskId,
      taskTitle: taskSpec.title,
      prNumber,
      approved: true,
      merged,
      reviewCycles: reviewResult.cycles,
      totalDuration,
    };
  } catch (err) {
    // Error inesperado — intentar cleanup
    logger.error(`Error inesperado: ${err.message}`, 'KOMODO');

    if (prNumber && repo) {
      closePR(repo, prNumber, `Error inesperado: ${err.message}`);
    }
    if (taskSpec?.taskId) {
      await rollbackTask(taskSpec.taskId);
    }

    return makeResult({
      success: false, taskSpec, prNumber, startTime,
      error: err.message,
    });
  }
}

/**
 * Helper para construir el objeto de resultado con valores por defecto.
 */
function makeResult({ success, taskSpec, prNumber, startTime, reviewCycles, error }) {
  return {
    success,
    taskId: taskSpec?.taskId || null,
    taskTitle: taskSpec?.title || null,
    prNumber: prNumber || null,
    approved: false,
    merged: false,
    reviewCycles: reviewCycles || 0,
    totalDuration: (Date.now() - startTime) / 1000,
    ...(error ? { error } : {}),
  };
}
