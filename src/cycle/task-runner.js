import { pickNextTask } from '../agents/planner.js';
import { implementTask, fixReviewIssues } from '../agents/coder.js';
import { reviewLoop } from './review-loop.js';
import { analyzeSonar } from '../sonar/analyzer.js';
import { executePrePRTests } from '../testing/pre-pr-tests.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { runGh } from '../../skills/github-mcp/src/gh-cli.js';
import { runAgent } from '../agents/base-agent.js';
import { eventBus, EVENT_TYPES, AGENT_STATES } from '../events/event-bus.js';
import { komodoState, PHASES, DASHBOARD_AGENT_STATES, EXECUTION_STATES } from '../state/komodo-state.js';
import { checkpointManager } from '../state/checkpoint-manager.js';
import { classifyAndEmit } from '../triage/complexity-classifier.js';
import { selectModel } from '../triage/model-selector.js';
import { shouldDecompose, decomposeTask } from '../triage/task-decomposer.js';
import { fallbackManager } from '../agents/fallback-manager.js';
import { withWatchdog } from '../watchdog/watchdog.js';
import { createTechDebtTasks } from '../tech-debt/tech-debt-tracker.js';
import { recordTaskMetrics } from '../estimation/estimation-tracker.js';
import { extractTaskKeywords } from '../smart-ordering/context-affinity.js';
import { getById } from '../../skills/planning-task-mcp/src/firebase.js';

/**
 * Fetches the codingGuidelines field from a project.
 * Returns empty string if not found or on error.
 */
async function fetchCodingGuidelines(projectId) {
  try {
    const project = await getById('projects', projectId);
    return (project && project.codingGuidelines) || '';
  } catch (err) {
    logger.warn(`Could not fetch codingGuidelines: ${err.message}`, 'KOMODO');
    return '';
  }
}

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
    logger.logStep(1, 6, 'Planner eligiendo tarea...', 'KOMODO');

    komodoState.updatePhase(PHASES.PLANNING);
    komodoState.updateAgent('PLANNER', { status: DASHBOARD_AGENT_STATES.WORKING });

    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'PLANNER',
      previousState: AGENT_STATES.IDLE,
      newState: AGENT_STATES.WORKING,
    });
    eventBus.emitAgentEvent('PLANNER', 'working');

    const plannerCli = config.cliPlanner;
    const plannerModel = selectModel(plannerCli, 'PLANNER', 'standard');

    const plannerResult = await withWatchdog(
      () => pickNextTask(projectId, { model: plannerModel }),
      { agentName: 'PLANNER', onCheckpoint: () => komodoState.setExecutionState(EXECUTION_STATES.PAUSED) },
    );

    if (plannerResult.cost) {
      eventBus.emitEvent(EVENT_TYPES.COST_UPDATED, {
        agentName: 'PLANNER',
        metadata: { cost: plannerResult.cost },
      });
    }

    eventBus.emitAgentEvent('PLANNER', 'done');
    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'PLANNER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.IDLE,
    });
    eventBus.emitAgentEvent('PLANNER', 'idle');
    komodoState.updateAgent('PLANNER', { status: DASHBOARD_AGENT_STATES.IDLE, currentTask: null });

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

    // ── Decomposition triage: break large tasks into subtasks ──
    const decompositionCheck = shouldDecompose(taskSpec);
    if (decompositionCheck.shouldDecompose) {
      logger.info(`Task needs decomposition: ${decompositionCheck.reasons.join(', ')}`, 'KOMODO');

      const decompResult = await decomposeTask(taskSpec, projectId);
      if (decompResult.success) {
        // Rollback the parent task status (it was set to in-progress by Planner)
        // The decomposeTask agent already marks it as "done" with decomposed=true.
        // Now re-run Planner to pick the first eligible subtask.
        logger.info('Re-running Planner to select first subtask...', 'KOMODO');

        komodoState.updateAgent('PLANNER', { status: DASHBOARD_AGENT_STATES.WORKING });
        const subtaskResult = await pickNextTask(projectId, { model: plannerModel });
        komodoState.updateAgent('PLANNER', { status: DASHBOARD_AGENT_STATES.IDLE, currentTask: null });

        if (!subtaskResult.success || !subtaskResult.task) {
          return makeResult({ success: false, startTime, error: subtaskResult.error || 'No subtask available after decomposition' });
        }

        taskSpec = subtaskResult.task;
        repo = extractOwnerRepo(taskSpec.repoUrl);
        logger.info(`Subtask selected: "${taskSpec.title}" | Branch: ${taskSpec.branchName}`, 'KOMODO');
      } else {
        logger.warn(`Decomposition failed (${decompResult.error}), proceeding with original task`, 'KOMODO');
      }
    }

    // ── Triage: classify complexity + select models ──
    const classification = classifyAndEmit(taskSpec);
    const complexityLevel = classification.level;
    const taskModelOverride = taskSpec.modelOverride || undefined;

    const coderCli = config.cliCoder;
    const reviewerCli = config.cliReviewer;

    const coderModel = selectModel(coderCli, 'CODER', complexityLevel, taskModelOverride);
    const reviewerModel = selectModel(reviewerCli, 'REVIEWER', complexityLevel, taskModelOverride);

    // Fetch project coding guidelines for injection into agent prompts
    const codingGuidelines = await fetchCodingGuidelines(projectId);
    if (codingGuidelines) {
      logger.info(`Coding guidelines loaded (${codingGuidelines.length} chars)`, 'KOMODO');
    }

    // Set checkpoint flow context for rate limit recovery
    checkpointManager.setFlowContext({
      branchName: taskSpec.branchName,
      repoUrl: taskSpec.repoUrl,
      flowStep: null, // will be set by phase
    });

    komodoState.updatePhase(PHASES.PLANNING, { currentTask: taskSpec.taskId });

    eventBus.emitEvent(EVENT_TYPES.TASK_STARTED, {
      metadata: {
        taskId: taskSpec.taskId,
        title: taskSpec.title,
        branchName: taskSpec.branchName,
        repo,
        priority: taskSpec.bizPoints || null,
      },
    });

    // ═══════════════════════════════════════════
    // PASO 2: CODER — Implementar
    // ═══════════════════════════════════════════
    logger.logStep(2, 6, 'Coder implementando...', 'KOMODO');

    komodoState.updatePhase(PHASES.CODING, { currentTask: taskSpec.taskId });
    komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.WORKING, currentTask: taskSpec.taskId });

    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'CODER',
      previousState: AGENT_STATES.IDLE,
      newState: AGENT_STATES.WORKING,
    });
    eventBus.emitAgentEvent('CODER', 'working', { taskId: taskSpec.taskId });

    let coderResult = await withWatchdog(
      () => implementTask(taskSpec, cwd, { model: coderModel, codingGuidelines }),
      {
        agentName: 'CODER',
        taskId: taskSpec.taskId,
        onCheckpoint: () => {
          komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
        },
      },
    );

    // Fallback retry: if Coder failed and a fallback CLI is available, retry once
    if (!coderResult.success && fallbackManager.isEnabled()) {
      const originalCli = config.cliCoder;
      if (fallbackManager.isRateLimited(originalCli)) {
        const fallbackCli = fallbackManager.getAvailableFallbackCli(originalCli);
        if (fallbackCli) {
          logger.info(`Coder failed due to rate limit on "${originalCli}". Retrying with fallback CLI "${fallbackCli}"...`, 'KOMODO');

          // AGENT_FALLBACK event is emitted by resolveEffectiveCli in base-agent.js
          // when runAgent detects the rate-limited CLI and resolves to fallback.
          const fallbackModel = selectModel(fallbackCli, 'CODER', complexityLevel, taskModelOverride);
          coderResult = await implementTask(taskSpec, cwd, { model: fallbackModel, codingGuidelines });

          // If fallback also fails, mark it as rate-limited too
          if (!coderResult.success && fallbackManager.isRateLimited(fallbackCli)) {
            logger.warn(`Fallback CLI "${fallbackCli}" also hit rate limit. Checkpoint will be triggered via event flow.`, 'KOMODO');
          }
        }
      }
    }

    if (coderResult.cost) {
      eventBus.emitEvent(EVENT_TYPES.COST_UPDATED, {
        agentName: 'CODER',
        metadata: { cost: coderResult.cost },
      });
    }

    eventBus.emitAgentEvent('CODER', 'done');
    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'CODER',
      previousState: AGENT_STATES.WORKING,
      newState: AGENT_STATES.IDLE,
    });
    eventBus.emitAgentEvent('CODER', 'idle');
    komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.IDLE, currentTask: null });

    if (!coderResult.success) {
      // Recovery: devolver tarea a to-do
      await rollbackTask(taskSpec.taskId);
      const result = makeResult({
        success: false, taskSpec, startTime,
        error: coderResult.error,
      });
      eventBus.emitEvent(EVENT_TYPES.TASK_COMPLETED, {
        metadata: { ...result, title: taskSpec.title },
      });
      return result;
    }

    prNumber = coderResult.pr.prNumber;
    logger.info(`PR #${prNumber} creada`, 'KOMODO');

    eventBus.emitEvent(EVENT_TYPES.PR_CREATED, {
      agentName: 'CODER',
      metadata: {
        prNumber,
        repo,
        taskId: taskSpec.taskId,
        branchName: taskSpec.branchName,
        filesChanged: coderResult.pr.filesChanged || [],
        summary: coderResult.pr.summary || '',
      },
    });

    // Check for rate limit pause before next step
    if (komodoState.isPauseRequested()) {
      logger.warn('Execution paused by rate limit after Coder step.', 'KOMODO');
      return makeResult({ success: false, taskSpec, prNumber, startTime, error: 'Paused: rate limit detected' });
    }

    // ═══════════════════════════════════════════
    // PASO 3: PRE-PR TESTS — Ejecutar tests antes de review
    // ═══════════════════════════════════════════
    logger.logStep(3, 6, 'Pre-PR tests...', 'KOMODO');

    komodoState.updatePhase(PHASES.ANALYZING, { currentPR: prNumber });

    const testReport = await executePrePRTests({
      cwd,
      onFixAttempt: async (failureOutput, attempt) => {
        logger.info(`Auto-fixing test failures (attempt ${attempt})...`, 'KOMODO');
        const fixResult = await fixReviewIssues(
          taskSpec,
          prNumber,
          {
            summary: 'Pre-PR tests are failing. Fix the test failures.',
            issues: [`Test output:\n${failureOutput.slice(0, 3000)}`],
          },
          cwd,
          { model: coderModel, codingGuidelines },
        );
        return { fixed: fixResult.success };
      },
    });

    if (!testReport.skipped) {
      if (testReport.passed) {
        logger.success(`Pre-PR tests passed: ${testReport.summary}`, 'KOMODO');
      } else if (testReport.needsManualReview) {
        logger.warn(`Tests failing after ${testReport.attempts} attempts — PR will include warning`, 'KOMODO');
        // Add warning note to PR via comment
        try {
          runGh([
            'pr', 'comment', String(prNumber),
            '--repo', repo,
            '--body', `⚠️ **[Tests failing - needs manual review]**\n\nPre-PR tests failed after ${testReport.attempts} attempts.\n\n<details>\n<summary>Last test output</summary>\n\n\`\`\`\n${testReport.output.slice(0, 5000)}\n\`\`\`\n</details>`,
          ]);
        } catch (err) {
          logger.warn(`Could not add test failure comment to PR: ${err.message}`, 'KOMODO');
        }
      }
    }

    // ═══════════════════════════════════════════
    // PASO 4: SONAR ANALYSIS — Análisis de calidad
    // ═══════════════════════════════════════════
    logger.logStep(4, 6, 'Análisis SonarQube...', 'KOMODO');
    logger.startSpinner('Ejecutando análisis SonarQube...', 'KOMODO');

    komodoState.updatePhase(PHASES.ANALYZING, { currentPR: prNumber });
    komodoState.sonarAnalysis = { status: 'running', qualityGate: null, issues: null };

    const sonarReport = await analyzeSonar({
      branch: taskSpec.branchName,
      cwd,
    });

    logger.stopSpinner();

    if (sonarReport.success) {
      komodoState.sonarAnalysis = {
        status: 'done',
        qualityGate: sonarReport.qualityGate,
        issues: sonarReport.issues,
      };
      logger.success(`SonarQube: Quality Gate ${sonarReport.qualityGate}`, 'KOMODO');
      logger.sonarSummary(sonarReport);
    } else if (sonarReport.skipped) {
      komodoState.sonarAnalysis = { status: 'skipped', qualityGate: null, issues: null };
      logger.info('SonarQube omitido, continuando con review...', 'KOMODO');
    } else {
      komodoState.sonarAnalysis = { status: 'error', qualityGate: null, issues: null };
    }

    // Check for rate limit pause before next step
    if (komodoState.isPauseRequested()) {
      logger.warn('Execution paused by rate limit after analysis step.', 'KOMODO');
      return makeResult({ success: false, taskSpec, prNumber, startTime, error: 'Paused: rate limit detected' });
    }

    // ═══════════════════════════════════════════
    // PASO 5: REVIEW LOOP — Reviewer ↔ Coder
    // ═══════════════════════════════════════════
    logger.logStep(5, 6, 'Review loop...', 'KOMODO');

    komodoState.updatePhase(PHASES.REVIEWING, { currentPR: prNumber, reviewCycle: 0 });
    komodoState.updateAgent('REVIEWER', { status: DASHBOARD_AGENT_STATES.WORKING });

    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'REVIEWER',
      previousState: AGENT_STATES.IDLE,
      newState: AGENT_STATES.WORKING,
    });
    eventBus.emitAgentEvent('REVIEWER', 'working', { prNumber });

    const reviewResult = await withWatchdog(
      () => reviewLoop({ prNumber, repo, taskSpec, cwd, sonarReport, reviewerModel, coderModel, codingGuidelines }),
      { agentName: 'REVIEWER', taskId: taskSpec.taskId, onCheckpoint: () => komodoState.setExecutionState(EXECUTION_STATES.PAUSED) },
    );

    eventBus.emitAgentEvent('REVIEWER', 'done');
    eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
      agentName: 'REVIEWER',
      previousState: AGENT_STATES.WAITING,
      newState: AGENT_STATES.IDLE,
    });
    eventBus.emitAgentEvent('REVIEWER', 'idle');
    komodoState.updateAgent('REVIEWER', { status: DASHBOARD_AGENT_STATES.IDLE, currentTask: null });

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
      const result = makeResult({
        success: false, taskSpec, prNumber, startTime,
        reviewCycles: reviewResult.cycles,
        error: reviewResult.error,
      });
      eventBus.emitEvent(EVENT_TYPES.TASK_COMPLETED, {
        metadata: { ...result, title: taskSpec.title },
      });
      return result;
    }

    // Tech debt: create tasks from minor/suggestion issues left after approved review
    try {
      const reviewIssues = reviewResult.finalReview?.issues || [];
      await createTechDebtTasks({ issues: reviewIssues, prNumber, projectId: projectId || config.defaultProjectId });
    } catch (err) {
      logger.warn(`Tech debt tracking failed (non-blocking): ${err.message}`, 'KOMODO');
    }

    // Check for rate limit pause before next step
    if (komodoState.isPauseRequested()) {
      logger.warn('Execution paused by rate limit after review step.', 'KOMODO');
      return makeResult({ success: false, taskSpec, prNumber, startTime, error: 'Paused: rate limit detected' });
    }

    // ═══════════════════════════════════════════
    // PASO 6: MERGE + UPDATE TASK
    // ═══════════════════════════════════════════
    logger.logStep(6, 6, 'Finalizando...', 'KOMODO');

    komodoState.updatePhase(PHASES.MERGING, { currentPR: prNumber });

    let merged = false;

    if (config.autoMerge) {
      try {
        mergePR(repo, prNumber);
        merged = true;
        eventBus.emitEvent(EVENT_TYPES.PR_MERGED, {
          metadata: { prNumber, repo, taskId: taskSpec.taskId },
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

    // Resumen final
    logger.taskHeader('RESUMEN');
    logger.info(`Tarea: "${taskSpec.title}"`, 'KOMODO');
    logger.info(`PR: #${prNumber}`, 'KOMODO');
    logger.info(`Review cycles: ${reviewResult.cycles}`, 'KOMODO');
    logger.info(`Merged: ${merged ? 'sí' : 'no (manual)'}`, 'KOMODO');
    logger.info(`Duración total: ${totalDuration.toFixed(1)}s`, 'KOMODO');

    eventBus.emitEvent(EVENT_TYPES.TASK_COMPLETED, {
      metadata: {
        taskId: taskSpec.taskId,
        title: taskSpec.title,
        prNumber,
        approved: true,
        merged,
        reviewCycles: reviewResult.cycles,
        totalDuration,
      },
    });

    // Record estimation metrics (best effort)
    try {
      await recordTaskMetrics({
        taskId: taskSpec.taskId,
        projectId: projectId || config.defaultProjectId,
        estimatedDevPoints: taskSpec.devPoints || 0,
        totalDuration,
        reviewCycles: reviewResult.cycles,
        approved: true,
        merged,
        filesChanged: coderResult.pr.filesChanged || [],
        model: coderModel || '',
      });
    } catch (err) {
      logger.warn(`Estimation tracking failed (non-blocking): ${err.message}`, 'KOMODO');
    }

    // Record context for smart task ordering (context affinity)
    komodoState.lastCompletedTaskContext = {
      taskId: taskSpec.taskId,
      title: taskSpec.title,
      filesChanged: coderResult.pr.filesChanged || [],
      keywords: extractTaskKeywords(taskSpec),
    };

    komodoState.updatePhase(PHASES.IDLE, {
      currentTask: null,
      currentPR: null,
      reviewCycle: 0,
    });

    checkpointManager.clearFlowContext();

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

    checkpointManager.clearFlowContext();

    if (prNumber && repo) {
      closePR(repo, prNumber, `Error inesperado: ${err.message}`);
    }
    if (taskSpec?.taskId) {
      await rollbackTask(taskSpec.taskId);
    }

    const result = makeResult({
      success: false, taskSpec, prNumber, startTime,
      error: err.message,
    });
    eventBus.emitEvent(EVENT_TYPES.TASK_COMPLETED, {
      metadata: { ...result, title: taskSpec?.title },
    });
    return result;
  }
}

/**
 * Reanuda la ejecución de una tarea desde el paso indicado por un checkpoint.
 *
 * Salta directamente al paso donde se pausó (code, review, fix, merge)
 * y continúa el flujo normal desde ahí.
 *
 * @param {Object} checkpoint - Checkpoint data loaded from JSON
 * @param {string} [cwd] - Directorio del repositorio
 * @returns {Promise<Object>} Resultado de la ejecución
 */
export async function resumeTask(checkpoint, cwd) {
  const startTime = Date.now();
  const { taskId, taskTitle, flowStep, branchName, prNumber, repoUrl, reviewRound, reviewIssues } = checkpoint;
  const repo = extractOwnerRepo(repoUrl);

  // Build a minimal taskSpec from checkpoint data
  const taskSpec = {
    taskId,
    title: taskTitle,
    branchName,
    repoUrl,
  };

  logger.taskHeader(`REANUDANDO: "${taskTitle}" desde paso "${flowStep}"`);
  logger.info(`Task: ${taskId} | Branch: ${branchName} | PR: ${prNumber || '(none)'}`, 'KOMODO');

  // Checkout to the correct branch
  if (branchName) {
    try {
      const { execFileSync } = await import('child_process');
      const resolvedCwd = cwd || config.rootDir;
      execFileSync('git', ['checkout', branchName], { cwd: resolvedCwd, stdio: 'pipe' });
      logger.info(`Checkout a branch: ${branchName}`, 'KOMODO');
    } catch (err) {
      // Branch might not exist locally, try fetching
      try {
        const { execFileSync } = await import('child_process');
        const resolvedCwd = cwd || config.rootDir;
        execFileSync('git', ['fetch', 'origin', branchName], { cwd: resolvedCwd, stdio: 'pipe' });
        execFileSync('git', ['checkout', branchName], { cwd: resolvedCwd, stdio: 'pipe' });
        logger.info(`Checkout a branch (tras fetch): ${branchName}`, 'KOMODO');
      } catch (fetchErr) {
        logger.error(`No se pudo hacer checkout a branch ${branchName}: ${fetchErr.message}`, 'KOMODO');
        return makeResult({ success: false, taskSpec, startTime, error: `Branch ${branchName} no encontrada` });
      }
    }
  }

  // Set checkpoint flow context for potential new rate limit
  checkpointManager.setFlowContext({
    branchName,
    repoUrl,
    flowStep: null,
  });

  // Update komodo state
  komodoState.updatePhase(PHASES.IDLE, {
    currentTask: taskId,
    currentPR: prNumber || null,
    reviewCycle: reviewRound || 0,
  });

  try {
    // ═══════════════════════════════════════════
    // Resume from CODE step: re-run Coder
    // ═══════════════════════════════════════════
    if (flowStep === 'code') {
      logger.logStep(2, 5, 'Reanudando Coder...', 'KOMODO');

      komodoState.updatePhase(PHASES.CODING, { currentTask: taskId });
      komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.WORKING, currentTask: taskId });

      const coderResult = await implementTask(taskSpec, cwd);

      komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.IDLE, currentTask: null });

      if (!coderResult.success) {
        await rollbackTask(taskId);
        return makeResult({ success: false, taskSpec, startTime, error: coderResult.error });
      }

      // Continue with analysis, review, merge from here
      return await _continueFromAnalysis(taskSpec, coderResult.pr.prNumber, repo, startTime, cwd);
    }

    // ═══════════════════════════════════════════
    // Resume from ANALYZE step: re-run analysis + review + merge
    // ═══════════════════════════════════════════
    if (flowStep === 'analyze') {
      if (!prNumber) {
        return makeResult({ success: false, taskSpec, startTime, error: 'No hay prNumber para análisis' });
      }
      return await _continueFromAnalysis(taskSpec, prNumber, repo, startTime, cwd);
    }

    // ═══════════════════════════════════════════
    // Resume from REVIEW step: re-run review loop + merge
    // ═══════════════════════════════════════════
    if (flowStep === 'review') {
      if (!prNumber) {
        return makeResult({ success: false, taskSpec, startTime, error: 'No hay prNumber para review' });
      }
      return await _continueFromReview(taskSpec, prNumber, repo, startTime, cwd);
    }

    // ═══════════════════════════════════════════
    // Resume from FIX step: re-run fix + review loop + merge
    // ═══════════════════════════════════════════
    if (flowStep === 'fix') {
      if (!prNumber) {
        return makeResult({ success: false, taskSpec, startTime, error: 'No hay prNumber para fix' });
      }
      return await _continueFromFix(taskSpec, prNumber, repo, reviewIssues, startTime, cwd);
    }

    // ═══════════════════════════════════════════
    // Resume from MERGE step: re-run merge
    // ═══════════════════════════════════════════
    if (flowStep === 'merge') {
      if (!prNumber) {
        return makeResult({ success: false, taskSpec, startTime, error: 'No hay prNumber para merge' });
      }
      return await _continueFromMerge(taskSpec, prNumber, repo, startTime);
    }

    // ═══════════════════════════════════════════
    // Resume from PLAN step: re-run full task (essentially a fresh run)
    // ═══════════════════════════════════════════
    if (flowStep === 'plan') {
      logger.info('Checkpoint en paso "plan" — se reejecutará la tarea completa.', 'KOMODO');
      return makeResult({ success: false, taskSpec, startTime, error: 'Checkpoint en plan — reejecuta con komodo run' });
    }

    return makeResult({ success: false, taskSpec, startTime, error: `flowStep desconocido: ${flowStep}` });
  } catch (err) {
    logger.error(`Error inesperado al reanudar: ${err.message}`, 'KOMODO');
    checkpointManager.clearFlowContext();

    if (prNumber && repo) {
      closePR(repo, prNumber, `Error inesperado en reanudación: ${err.message}`);
    }
    if (taskSpec?.taskId) {
      await rollbackTask(taskSpec.taskId);
    }

    return makeResult({ success: false, taskSpec, prNumber, startTime, error: err.message });
  }
}

/**
 * Continue execution from the analysis step onwards (analysis → review → merge).
 * @private
 */
async function _continueFromAnalysis(taskSpec, prNumber, repo, startTime, cwd) {
  logger.logStep(3, 5, 'Análisis SonarQube...', 'KOMODO');
  logger.startSpinner('Ejecutando análisis SonarQube...', 'KOMODO');
  komodoState.updatePhase(PHASES.ANALYZING, { currentPR: prNumber });
  komodoState.sonarAnalysis = { status: 'running', qualityGate: null, issues: null };

  const sonarReport = await analyzeSonar({ branch: taskSpec.branchName, cwd });

  logger.stopSpinner();

  if (sonarReport.success) {
    komodoState.sonarAnalysis = {
      status: 'done',
      qualityGate: sonarReport.qualityGate,
      issues: sonarReport.issues,
    };
    logger.success(`SonarQube: Quality Gate ${sonarReport.qualityGate}`, 'KOMODO');
    logger.sonarSummary(sonarReport);
  } else if (sonarReport.skipped) {
    komodoState.sonarAnalysis = { status: 'skipped', qualityGate: null, issues: null };
    logger.info('SonarQube omitido, continuando con review...', 'KOMODO');
  } else {
    komodoState.sonarAnalysis = { status: 'error', qualityGate: null, issues: null };
  }

  if (komodoState.isPauseRequested()) {
    logger.warn('Execution paused by rate limit after analysis step.', 'KOMODO');
    return makeResult({ success: false, taskSpec, prNumber, startTime, error: 'Paused: rate limit detected' });
  }

  return await _continueFromReview(taskSpec, prNumber, repo, startTime, cwd, sonarReport);
}

/**
 * Continue execution from the review step onwards (review → merge).
 * @private
 */
async function _continueFromReview(taskSpec, prNumber, repo, startTime, cwd, sonarReport) {
  logger.logStep(4, 5, 'Review loop...', 'KOMODO');
  komodoState.updatePhase(PHASES.REVIEWING, { currentPR: prNumber, reviewCycle: 0 });
  komodoState.updateAgent('REVIEWER', { status: DASHBOARD_AGENT_STATES.WORKING });

  const reviewResult = await reviewLoop({ prNumber, repo, taskSpec, cwd, sonarReport });

  komodoState.updateAgent('REVIEWER', { status: DASHBOARD_AGENT_STATES.IDLE, currentTask: null });

  // Record outcome (best effort)
  try { await recordOutcome(reviewResult.approved, reviewResult.cycles); } catch { /* noop */ }

  if (!reviewResult.approved) {
    closePR(repo, prNumber, reviewResult.error || 'Review no aprobada');
    await rollbackTask(taskSpec.taskId);
    return makeResult({
      success: false, taskSpec, prNumber, startTime,
      reviewCycles: reviewResult.cycles, error: reviewResult.error,
    });
  }

  // Tech debt: create tasks from minor/suggestion issues left after approved review
  try {
    const reviewIssues = reviewResult.finalReview?.issues || [];
    await createTechDebtTasks({ issues: reviewIssues, prNumber, projectId: config.defaultProjectId });
  } catch (err) {
    logger.warn(`Tech debt tracking failed (non-blocking): ${err.message}`, 'KOMODO');
  }

  if (komodoState.isPauseRequested()) {
    logger.warn('Execution paused by rate limit after review step.', 'KOMODO');
    return makeResult({ success: false, taskSpec, prNumber, startTime, error: 'Paused: rate limit detected' });
  }

  return await _continueFromMerge(taskSpec, prNumber, repo, startTime, reviewResult.cycles);
}

/**
 * Continue execution from the fix step: apply fixes then review again.
 * @private
 */
async function _continueFromFix(taskSpec, prNumber, repo, reviewIssues, startTime, cwd) {
  logger.logStep(4, 5, 'Reanudando fix de issues...', 'KOMODO');

  checkpointManager.setFlowContext({ flowStep: 'fix', reviewIssues: reviewIssues || [] });
  komodoState.updatePhase(PHASES.REVIEWING, { currentPR: prNumber });
  komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.WORKING });

  // Build a minimal review feedback from checkpoint issues
  const reviewFeedback = {
    summary: 'Issues from previous review (resumed from checkpoint)',
    issues: (reviewIssues || []),
  };

  const fixResult = await fixReviewIssues(taskSpec, prNumber, reviewFeedback, cwd);

  komodoState.updateAgent('CODER', { status: DASHBOARD_AGENT_STATES.IDLE });

  if (!fixResult.success) {
    logger.error(`Coder no pudo arreglar issues: ${fixResult.error}`, 'KOMODO');
    return makeResult({ success: false, taskSpec, prNumber, startTime, error: fixResult.error });
  }

  logger.success('Fixes aplicados. Continuando con review...', 'KOMODO');

  // Continue with review loop
  return await _continueFromReview(taskSpec, prNumber, repo, startTime, cwd);
}

/**
 * Continue execution from the merge step.
 * @private
 */
async function _continueFromMerge(taskSpec, prNumber, repo, startTime, reviewCycles = 0) {
  logger.logStep(5, 5, 'Finalizando...', 'KOMODO');
  komodoState.updatePhase(PHASES.MERGING, { currentPR: prNumber });

  let merged = false;

  if (config.autoMerge) {
    try {
      mergePR(repo, prNumber);
      merged = true;
      eventBus.emitEvent(EVENT_TYPES.PR_MERGED, {
        metadata: { prNumber, repo, taskId: taskSpec.taskId },
      });
    } catch (err) {
      logger.error(`Error al mergear PR #${prNumber}: ${err.message}`, 'KOMODO');
    }

    try { await changeTaskStatus(taskSpec.taskId, 'done'); } catch { /* noop */ }
  } else {
    logger.info('AUTO_MERGE=false → PR aprobada, esperando merge manual.', 'KOMODO');
    try { await changeTaskStatus(taskSpec.taskId, 'to-validate'); } catch { /* noop */ }
  }

  const totalDuration = (Date.now() - startTime) / 1000;

  logger.taskHeader('RESUMEN (reanudación)');
  logger.info(`Tarea: "${taskSpec.title}"`, 'KOMODO');
  logger.info(`PR: #${prNumber}`, 'KOMODO');
  logger.info(`Merged: ${merged ? 'sí' : 'no (manual)'}`, 'KOMODO');
  logger.info(`Duración reanudación: ${totalDuration.toFixed(1)}s`, 'KOMODO');

  komodoState.updatePhase(PHASES.IDLE, {
    currentTask: null,
    currentPR: null,
    reviewCycle: 0,
  });

  checkpointManager.clearFlowContext();

  return {
    success: true,
    taskId: taskSpec.taskId,
    taskTitle: taskSpec.title,
    prNumber,
    approved: true,
    merged,
    reviewCycles,
    totalDuration,
    resumed: true,
  };
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
