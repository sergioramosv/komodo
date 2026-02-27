import { pickNextTask } from '../../../../src/agents/planner.js';
import { config } from '../config.js';

export const plannerTools = {
  plan_next_task: {
    description: 'Ejecuta el agente PLANNER para analizar el backlog y elegir la siguiente tarea de mayor prioridad. La marca como "in-progress" en Firebase. Operacion de 15-60 segundos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'ID del proyecto. Si no se pasa, usa DEFAULT_PROJECT_ID del .env.',
        },
      },
    },
    handler: async ({ projectId } = {}) => {
      const pid = projectId || config.defaultProjectId;
      if (!pid) {
        return { error: 'Se requiere projectId o configurar DEFAULT_PROJECT_ID en .env' };
      }

      const result = await pickNextTask(pid);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          cost: result.cost,
          duration: result.duration,
        };
      }

      if (!result.task) {
        return {
          success: true,
          message: 'No hay tareas pendientes en el backlog.',
          cost: result.cost,
          duration: result.duration,
        };
      }

      return {
        success: true,
        task: result.task,
        cost: result.cost,
        duration: result.duration,
        nextStep: 'Usa code_task con el taskSpec devuelto para implementar esta tarea.',
      };
    },
  },
};
