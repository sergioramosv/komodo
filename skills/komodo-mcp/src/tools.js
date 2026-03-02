/**
 * Komodo MCP Tools
 *
 * 8 tools para orquestar agentes IA desde cualquier cliente MCP:
 *
 * Paso a paso (recomendado):
 *   1. komodo_plan     → Planner elige tarea
 *   2. komodo_code     → Coder implementa
 *   3. komodo_review   → Reviewer revisa PR
 *   4. komodo_fix      → Coder arregla issues (si hay)
 *   5. komodo_finalize → Merge/close PR + actualizar tarea
 *
 * Ciclo completo:
 *   6. komodo_run      → Ejecuta N tareas completas
 *
 * Recovery:
 *   7. komodo_resume   → Reanuda desde checkpoint
 *
 * Info:
 *   8. komodo_status   → Configuración actual
 */

import { z } from 'zod';

// ─── Dynamic imports (env already loaded by index.js) ─────────────────

const { pickNextTask } = await import('../../../src/agents/planner.js');
const { implementTask, fixReviewIssues } = await import('../../../src/agents/coder.js');
const { reviewPR } = await import('../../../src/agents/reviewer.js');
const { run, resume } = await import('../../../src/orchestrator.js');
const { config, validateConfig } = await import('../../../src/config.js');
const { runAgent } = await import('../../../src/agents/base-agent.js');
const { eventBus, EVENT_TYPES } = await import('../../../src/events/event-bus.js');
const { checkpointManager } = await import('../../../src/state/checkpoint-manager.js');

let runGh;
try {
  const ghCli = await import('../../github-mcp/src/gh-cli.js');
  runGh = ghCli.runGh;
} catch {
  runGh = null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractOwnerRepo(repoUrl) {
  if (!repoUrl) return '';
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1].replace(/\.git$/, '') : repoUrl;
}

async function changeTaskStatus(taskId, newStatus) {
  await runAgent({
    name: 'KOMODO',
    systemPrompt: 'Eres un asistente que actualiza el estado de tareas. Cambia el estado y responde con JSON: { "updated": true }.',
    userPrompt: `Usa change_task_status para cambiar la tarea "${taskId}" a estado "${newStatus}". Responde con { "updated": true }.`,
    mcpServerNames: ['planning-task-mcp'],
    maxTurns: 5,
  });
}

// ─── Tools ────────────────────────────────────────────────────────────

export const tools = {

  // ═══════════════════════════════════════════
  // 1. PLAN — Planner elige la siguiente tarea
  // ═══════════════════════════════════════════

  komodo_plan: {
    description: [
      'Ejecuta el agente PLANNER para seleccionar la siguiente tarea de mayor prioridad del backlog.',
      'Analiza las tareas to-do, calcula prioridad (bizPoints/devPoints), considera dependencias y sprint activo.',
      'Marca la tarea como "in-progress" y devuelve sus detalles completos.',
      'Después de este paso, usa komodo_code con los datos devueltos.',
    ].join(' '),

    schema: {
      projectId: z.string().optional().describe(
        'ID del proyecto en planning-task-mcp. Si no se pasa, usa DEFAULT_PROJECT_ID del .env.'
      ),
    },

    handler: async ({ projectId }) => {
      const pid = projectId || config.defaultProjectId;
      if (!pid) {
        throw new Error('projectId requerido. No hay DEFAULT_PROJECT_ID configurado en .env.');
      }

      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'PLANNER',
        previousState: 'idle',
        newState: 'working',
        metadata: { phase: 'planning' },
      });

      const result = await pickNextTask(pid);

      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'PLANNER',
        previousState: 'working',
        newState: 'idle',
        metadata: { phase: 'idle' },
      });

      if (!result.success) {
        return { success: false, error: result.error, duration: result.duration };
      }

      if (!result.task) {
        return {
          success: true,
          task: null,
          message: 'No hay tareas pendientes en el backlog.',
          duration: result.duration,
        };
      }

      return {
        success: true,
        task: result.task,
        duration: result.duration,
        nextStep: 'Usa komodo_code con los datos de task para implementar.',
      };
    },
  },

  // ═══════════════════════════════════════════
  // 2. CODE — Coder implementa la tarea
  // ═══════════════════════════════════════════

  komodo_code: {
    description: [
      'Ejecuta el agente CODER para implementar una tarea.',
      'Crea branch, escribe código, commitea, push y abre Pull Request.',
      'Usa los datos de la tarea devueltos por komodo_plan.',
      'Después de este paso, usa komodo_review con el prNumber devuelto.',
    ].join(' '),

    schema: {
      taskId: z.string().describe('ID de la tarea (de komodo_plan)'),
      title: z.string().describe('Título de la tarea'),
      branchName: z.string().describe('Nombre de la branch (de komodo_plan)'),
      repoUrl: z.string().describe('URL del repositorio GitHub (de komodo_plan)'),
      userStoryWho: z.string().optional().describe('User Story: Como... (quién). Default: "usuario"'),
      userStoryWhat: z.string().optional().describe('User Story: Quiero... (qué)'),
      userStoryWhy: z.string().optional().describe('User Story: Para... (beneficio)'),
      acceptanceCriteria: z.array(z.string()).optional().describe('Criterios de aceptación (array de strings)'),
      devPoints: z.number().optional().describe('Puntos de desarrollo'),
      bizPoints: z.number().optional().describe('Puntos de negocio'),
      cwd: z.string().optional().describe(
        'Directorio del repositorio donde el Coder trabaja. Si no se pasa, usa el rootDir de Komodo.'
      ),
    },

    handler: async (params) => {
      const taskSpec = {
        taskId: params.taskId,
        title: params.title,
        branchName: params.branchName,
        repoUrl: params.repoUrl,
        userStory: {
          who: params.userStoryWho || 'usuario',
          what: params.userStoryWhat || params.title,
          why: params.userStoryWhy || 'mejorar la aplicación',
        },
        acceptanceCriteria: params.acceptanceCriteria || [],
        devPoints: params.devPoints || 0,
        bizPoints: params.bizPoints || 0,
      };

      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'CODER',
        previousState: 'idle',
        newState: 'working',
        metadata: { phase: 'coding', taskId: params.taskId },
      });

      const result = await implementTask(taskSpec, params.cwd);

      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'CODER',
        previousState: 'working',
        newState: 'idle',
        metadata: { phase: 'idle' },
      });

      if (!result.success) {
        return { success: false, error: result.error, duration: result.duration };
      }

      return {
        success: true,
        pr: result.pr,
        repo: extractOwnerRepo(params.repoUrl),
        duration: result.duration,
        nextStep: `Usa komodo_review con prNumber=${result.pr.prNumber} y repo="${extractOwnerRepo(params.repoUrl)}" para revisar la PR.`,
      };
    },
  },

  // ═══════════════════════════════════════════
  // 3. REVIEW — Reviewer revisa la PR
  // ═══════════════════════════════════════════

  komodo_review: {
    description: [
      'Ejecuta el agente REVIEWER para hacer code review de una Pull Request.',
      'Revisa 8 criterios: correctitud, error handling, edge cases, naming, estructura, tests, seguridad, patrones.',
      'Devuelve verdict (APPROVED/REQUEST_CHANGES), score, issues y positivos.',
      'Si REQUEST_CHANGES: usa komodo_fix para corregir. Si APPROVED: usa komodo_finalize.',
    ].join(' '),

    schema: {
      prNumber: z.number().describe('Número de la Pull Request'),
      repo: z.string().describe('Repositorio en formato owner/repo (ej: "SergioRVDev/my-app")'),
      taskTitle: z.string().describe('Título de la tarea (para contexto del review)'),
      userStoryWho: z.string().optional().describe('User Story: Como...'),
      userStoryWhat: z.string().optional().describe('User Story: Quiero...'),
      userStoryWhy: z.string().optional().describe('User Story: Para...'),
      acceptanceCriteria: z.array(z.string()).optional().describe('Criterios de aceptación'),
      cwd: z.string().optional().describe('Directorio del repositorio'),
      sonarReport: z.object({
        success: z.boolean(),
        qualityGate: z.string().nullable(),
        issues: z.object({
          BLOCKER: z.number(),
          CRITICAL: z.number(),
          MAJOR: z.number(),
          MINOR: z.number(),
          INFO: z.number(),
          total: z.number(),
        }),
        issueDetails: z.array(z.object({
          severity: z.string(),
          file: z.string(),
          line: z.number(),
          message: z.string(),
          rule: z.string(),
        })).optional(),
        metrics: z.object({
          bugs: z.number(),
          vulnerabilities: z.number(),
          code_smells: z.number(),
          duplicated_lines_density: z.number(),
          coverage: z.number(),
        }),
      }).optional().describe('Reporte de análisis SonarQube (opcional)'),
    },

    handler: async (params) => {
      const taskSpec = {
        title: params.taskTitle,
        userStory: {
          who: params.userStoryWho || 'usuario',
          what: params.userStoryWhat || params.taskTitle,
          why: params.userStoryWhy || 'mejorar la aplicación',
        },
        acceptanceCriteria: params.acceptanceCriteria || [],
      };

      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'REVIEWER',
        previousState: 'idle',
        newState: 'working',
        metadata: { phase: 'reviewing', prNumber: params.prNumber },
      });

      const result = await reviewPR({
        prNumber: params.prNumber,
        repo: params.repo,
        taskSpec,
        cwd: params.cwd,
        sonarReport: params.sonarReport,
      });

      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'REVIEWER',
        previousState: 'working',
        newState: 'idle',
        metadata: { phase: 'idle' },
      });

      if (!result.success) {
        return { success: false, error: result.error, duration: result.duration };
      }

      const review = result.review;
      const approved = review.verdict === 'APPROVED';

      return {
        success: true,
        review,
        approved,
        duration: result.duration,
        nextStep: approved
          ? `PR aprobada. Usa komodo_finalize con approved=true para mergear.`
          : `PR con cambios solicitados. Usa komodo_fix para corregir los ${(review.issues || []).length} issues.`,
      };
    },
  },

  // ═══════════════════════════════════════════
  // 4. FIX — Coder arregla issues del review
  // ═══════════════════════════════════════════

  komodo_fix: {
    description: [
      'Ejecuta el agente CODER en modo fix para arreglar issues encontrados por el Reviewer.',
      'Lee el feedback, arregla cada issue, commitea con "fix: ..." y pushea al mismo branch.',
      'NO crea nueva PR. Después de este paso, usa komodo_review de nuevo para re-revisar.',
    ].join(' '),

    schema: {
      taskId: z.string().describe('ID de la tarea'),
      title: z.string().describe('Título de la tarea'),
      branchName: z.string().describe('Branch de la PR'),
      repoUrl: z.string().describe('URL del repositorio'),
      prNumber: z.number().describe('Número de la PR'),
      reviewSummary: z.string().describe('Resumen del review (de komodo_review → review.summary)'),
      reviewIssues: z.array(z.string()).describe(
        'Lista de issues a arreglar. Cada string describe un issue (de review.issues[].description o el issue completo como texto).'
      ),
      cwd: z.string().optional().describe('Directorio del repositorio'),
    },

    handler: async (params) => {
      const taskSpec = {
        taskId: params.taskId,
        title: params.title,
        branchName: params.branchName,
        repoUrl: params.repoUrl,
      };

      const reviewFeedback = {
        summary: params.reviewSummary,
        issues: params.reviewIssues.map(desc => ({ description: desc })),
      };

      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'CODER',
        previousState: 'idle',
        newState: 'working',
        metadata: { phase: 'coding', prNumber: params.prNumber, fixing: true },
      });

      const result = await fixReviewIssues(taskSpec, params.prNumber, reviewFeedback, params.cwd);

      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'CODER',
        previousState: 'working',
        newState: 'idle',
        metadata: { phase: 'idle' },
      });

      if (!result.success) {
        return { success: false, error: result.error, duration: result.duration };
      }

      return {
        success: true,
        fix: result.fix,
        duration: result.duration,
        nextStep: `Fixes pusheados. Usa komodo_review de nuevo con prNumber=${params.prNumber} para re-revisar.`,
      };
    },
  },

  // ═══════════════════════════════════════════
  // 5. FINALIZE — Merge/close PR + task status
  // ═══════════════════════════════════════════

  komodo_finalize: {
    description: [
      'Finaliza una tarea: mergea o cierra la PR y actualiza el estado de la tarea.',
      'Si approved=true y AUTO_MERGE=true: mergea la PR (squash) y marca tarea como "done".',
      'Si approved=true y AUTO_MERGE=false: marca tarea como "to-validate" (merge manual).',
      'Si approved=false: cierra la PR y devuelve la tarea a "to-do".',
    ].join(' '),

    schema: {
      taskId: z.string().describe('ID de la tarea'),
      prNumber: z.number().describe('Número de la Pull Request'),
      repo: z.string().describe('Repositorio en formato owner/repo'),
      approved: z.boolean().describe('true si la PR fue aprobada, false si no'),
    },

    handler: async (params) => {
      const { taskId, prNumber, repo, approved } = params;

      if (!approved) {
        // Close PR + rollback task
        if (runGh) {
          try {
            runGh([
              'pr', 'close', String(prNumber),
              '--repo', repo,
              '--comment', 'Cerrada automáticamente por Komodo: review no aprobada.',
              '--delete-branch',
            ]);
          } catch (err) {
            // Non-fatal: PR might already be closed
          }
        }

        try {
          await changeTaskStatus(taskId, 'to-do');
        } catch (err) {
          return {
            success: false,
            error: `PR cerrada pero no se pudo revertir tarea: ${err.message}`,
          };
        }

        return {
          success: true,
          action: 'closed',
          merged: false,
          taskStatus: 'to-do',
          message: `PR #${prNumber} cerrada. Tarea devuelta a to-do.`,
        };
      }

      // Approved
      let merged = false;

      if (config.autoMerge) {
        if (runGh) {
          try {
            runGh([
              'pr', 'merge', String(prNumber),
              '--repo', repo,
              '--squash',
              '--delete-branch',
            ]);
            merged = true;
          } catch (err) {
            return {
              success: false,
              error: `Error al mergear PR #${prNumber}: ${err.message}`,
            };
          }
        } else {
          return {
            success: false,
            error: 'gh CLI no disponible para merge. Instala gh: https://cli.github.com/',
          };
        }

        try {
          await changeTaskStatus(taskId, 'done');
        } catch (err) {
          // Non-fatal: PR merged but task status might not update
        }

        return {
          success: true,
          action: 'merged',
          merged: true,
          taskStatus: 'done',
          message: `PR #${prNumber} mergeada (squash). Tarea marcada como done.`,
        };
      }

      // Auto-merge disabled → manual merge
      try {
        await changeTaskStatus(taskId, 'to-validate');
      } catch (err) {
        // Non-fatal
      }

      return {
        success: true,
        action: 'pending-merge',
        merged: false,
        taskStatus: 'to-validate',
        message: `AUTO_MERGE=false. PR #${prNumber} aprobada, esperando merge manual. Tarea en to-validate.`,
      };
    },
  },

  // ═══════════════════════════════════════════
  // 6. RUN — Ciclo completo de N tareas
  // ═══════════════════════════════════════════

  komodo_run: {
    description: [
      'Ejecuta el ciclo completo de Komodo para N tareas: Planner → Coder → Review loop → Merge.',
      'Incluye error recovery automático (rollback de tareas y cierre de PRs huérfanas).',
      'Para flujo con control manual, se recomienda usar los tools individuales (komodo_plan → komodo_code → etc).',
    ].join(' '),

    schema: {
      projectId: z.string().optional().describe('ID del proyecto. Default: DEFAULT_PROJECT_ID del .env.'),
      tasks: z.number().optional().describe('Número de tareas a ejecutar. Default: 1. Usa 0 para modo continuo (hasta vaciar backlog).'),
      cwd: z.string().optional().describe('Directorio del repositorio target.'),
      dryRun: z.boolean().optional().describe('Si true, solo simula: muestra qué tarea elegiría sin ejecutar nada.'),
    },

    handler: async (params) => {
      const pid = params.projectId || config.defaultProjectId;
      if (!pid) {
        throw new Error('projectId requerido. No hay DEFAULT_PROJECT_ID configurado en .env.');
      }

      const result = await run(pid, {
        tasks: params.tasks ?? 1,
        cwd: params.cwd,
        dryRun: params.dryRun ?? false,
      });

      return result;
    },
  },

  // ═══════════════════════════════════════════
  // 7. RESUME — Reanudar desde checkpoint
  // ═══════════════════════════════════════════

  komodo_resume: {
    description: [
      'Reanuda la ejecución de una tarea pausada por rate limit.',
      'Busca el checkpoint más reciente en .komodo/checkpoints/, valida que los recursos (branch, PR) existan,',
      'y retoma el flujo exactamente donde se pausó (code, review, fix o merge).',
      'Tras reanudación exitosa, elimina el checkpoint automáticamente.',
    ].join(' '),

    schema: {
      cwd: z.string().optional().describe(
        'Directorio del repositorio donde reanudar. Si no se pasa, usa el rootDir de Komodo.'
      ),
    },

    handler: async (params) => {
      // Check for pending checkpoints first
      const pendingCheckpoints = await checkpointManager.listPendingCheckpoints();

      if (pendingCheckpoints.length === 0) {
        return {
          success: true,
          resumed: false,
          message: 'No hay checkpoints pendientes. Nada que reanudar.',
        };
      }

      const { filepath, checkpoint } = pendingCheckpoints[0];

      // Validate
      const validation = checkpointManager.validateCheckpoint(checkpoint);
      if (!validation.valid) {
        await checkpointManager.deleteCheckpoint(filepath);
        return {
          success: false,
          resumed: false,
          message: `Checkpoint descartado: ${validation.reason}`,
        };
      }

      const result = await resume({ cwd: params.cwd });

      return {
        success: result.tasksCompleted > 0,
        resumed: result.tasksCompleted > 0,
        checkpoint: {
          taskId: checkpoint.taskId,
          taskTitle: checkpoint.taskTitle,
          flowStep: checkpoint.flowStep,
          branchName: checkpoint.branchName,
          prNumber: checkpoint.prNumber,
        },
        result: result.results[0] || null,
        message: result.tasksCompleted > 0
          ? `Tarea "${checkpoint.taskTitle}" reanudada exitosamente desde paso "${checkpoint.flowStep}".`
          : `No se pudo reanudar: ${result.results[0]?.error || 'error desconocido'}`,
      };
    },
  },

  // ═══════════════════════════════════════════
  // 8. STATUS — Configuración actual
  // ═══════════════════════════════════════════

  komodo_status: {
    description: [
      'Devuelve la configuración actual de Komodo: CLIs de agentes, proyecto, auto-merge, review cycles, etc.',
      'También valida que la configuración sea correcta y reporta errores.',
    ].join(' '),

    schema: {},

    handler: async () => {
      const errors = validateConfig();

      return {
        config: {
          cliPlanner: config.cliPlanner,
          cliCoder: config.cliCoder,
          cliReviewer: config.cliReviewer,
          defaultProjectId: config.defaultProjectId || '(no configurado)',
          defaultUserId: config.defaultUserId ? '***' + config.defaultUserId.slice(-6) : '(no configurado)',
          defaultUserName: config.defaultUserName || '(no configurado)',
          autoMerge: config.autoMerge,
          maxReviewCycles: config.maxReviewCycles,
          firebaseConfigured: !!config.googleCredentials && !!config.firebaseDatabaseUrl,
          githubTokenConfigured: !!config.githubToken,
        },
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  },
};
