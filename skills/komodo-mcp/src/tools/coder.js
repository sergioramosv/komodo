import { implementTask, fixReviewIssues } from '../../../../src/agents/coder.js';

export const coderTools = {
  code_task: {
    description: 'Ejecuta el agente CODER para implementar una tarea. Crea branch, escribe codigo, commitea, push, y abre una Pull Request. Operacion larga: 1-5 minutos.',
    inputSchema: {
      type: 'object',
      properties: {
        taskSpec: {
          type: 'object',
          description: 'Especificacion de la tarea (viene de plan_next_task). Incluye taskId, title, userStory, acceptanceCriteria, branchName, repoUrl.',
        },
        cwd: {
          type: 'string',
          description: 'Directorio del repositorio donde el Coder trabajara.',
        },
      },
      required: ['taskSpec'],
    },
    handler: async ({ taskSpec, cwd }) => {
      if (!taskSpec || !taskSpec.taskId) {
        return { error: 'Se requiere taskSpec con al menos taskId, title, branchName, y repoUrl.' };
      }

      const result = await implementTask(taskSpec, cwd);

      return {
        success: result.success,
        pr: result.pr || null,
        cost: result.cost,
        duration: result.duration,
        error: result.error || null,
        nextStep: result.success
          ? `PR #${result.pr?.prNumber} creada. Usa review_pr o run_review_loop para revisarla.`
          : null,
      };
    },
  },

  fix_review_issues: {
    description: 'Ejecuta el agente CODER para arreglar issues encontrados por el Reviewer. Pushea fixes al mismo branch sin crear nueva PR. Operacion de 1-3 minutos.',
    inputSchema: {
      type: 'object',
      properties: {
        taskSpec: {
          type: 'object',
          description: 'Especificacion de la tarea original.',
        },
        prNumber: {
          type: 'number',
          description: 'Numero de la PR existente.',
        },
        reviewFeedback: {
          type: 'object',
          description: 'Feedback del reviewer: { issues: [...], summary: "..." }.',
        },
        cwd: {
          type: 'string',
          description: 'Directorio del repositorio.',
        },
      },
      required: ['taskSpec', 'prNumber', 'reviewFeedback'],
    },
    handler: async ({ taskSpec, prNumber, reviewFeedback, cwd }) => {
      const result = await fixReviewIssues(taskSpec, prNumber, reviewFeedback, cwd);

      return {
        success: result.success,
        fix: result.fix || null,
        cost: result.cost,
        duration: result.duration,
        error: result.error || null,
      };
    },
  },
};
