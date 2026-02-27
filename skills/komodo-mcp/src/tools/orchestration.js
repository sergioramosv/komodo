import { runTask, runTaskDryRun } from '../../../../src/cycle/task-runner.js';
import { config } from '../config.js';

export const orchestrationTools = {
  run_full_cycle: {
    description: 'Ejecuta el ciclo COMPLETO de Komodo para una tarea: Planner elige tarea -> Coder implementa -> Reviewer revisa (con loop de fixes) -> Merge automatico. Equivale a "komodo run". Operacion MUY larga: 3-15 minutos. Incluye error recovery (si falla, cierra PRs y devuelve tarea a to-do).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'ID del proyecto. Si no se pasa, usa DEFAULT_PROJECT_ID.',
        },
        cwd: {
          type: 'string',
          description: 'Directorio del repositorio donde el Coder trabajara.',
        },
      },
    },
    handler: async ({ projectId, cwd } = {}) => {
      const pid = projectId || config.defaultProjectId;
      if (!pid) {
        return { error: 'Se requiere projectId o configurar DEFAULT_PROJECT_ID en .env' };
      }

      const result = await runTask(pid, cwd);

      return {
        success: result.success,
        taskId: result.taskId,
        taskTitle: result.taskTitle,
        prNumber: result.prNumber,
        approved: result.approved,
        merged: result.merged,
        reviewCycles: result.reviewCycles,
        totalDuration: result.totalDuration,
        error: result.error || null,
      };
    },
  },

  run_dry_run: {
    description: 'Ejecuta el Planner en modo SIMULACION: analiza el backlog y reporta que tarea elegiria, SIN cambiar ningun estado en Firebase. Util para previsualizar que haria Komodo. Operacion de 15-30 segundos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'ID del proyecto. Si no se pasa, usa DEFAULT_PROJECT_ID.',
        },
      },
    },
    handler: async ({ projectId } = {}) => {
      const pid = projectId || config.defaultProjectId;
      if (!pid) {
        return { error: 'Se requiere projectId o configurar DEFAULT_PROJECT_ID en .env' };
      }

      const result = await runTaskDryRun(pid);

      return {
        success: result.success,
        task: result.task || null,
        totalDuration: result.totalDuration,
        error: result.error || null,
        note: 'Esto es una simulacion. Ningun estado fue modificado.',
      };
    },
  },
};
