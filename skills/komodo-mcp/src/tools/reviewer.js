import { reviewPR } from '../../../../src/agents/reviewer.js';

export const reviewerTools = {
  review_pr: {
    description: 'Ejecuta el agente REVIEWER para revisar una Pull Request. Evalua correctitud, error handling, edge cases, naming, estructura, tests, seguridad y patrones conocidos. Envia review en GitHub (APPROVE o REQUEST_CHANGES). Operacion de 30-90 segundos.',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'number',
          description: 'Numero de la Pull Request a revisar.',
        },
        repo: {
          type: 'string',
          description: 'Repositorio en formato owner/repo (ej: SergioRVDev/my-app).',
        },
        taskSpec: {
          type: 'object',
          description: 'Especificacion de la tarea para dar contexto al Reviewer.',
        },
        cwd: {
          type: 'string',
          description: 'Directorio del repositorio (opcional).',
        },
      },
      required: ['prNumber', 'repo'],
    },
    handler: async ({ prNumber, repo, taskSpec, cwd }) => {
      const spec = taskSpec || { title: `PR #${prNumber}`, userStory: {}, acceptanceCriteria: [] };

      const result = await reviewPR({ prNumber, repo, taskSpec: spec, cwd });

      return {
        success: result.success,
        review: result.review || null,
        cost: result.cost,
        duration: result.duration,
        error: result.error || null,
        nextStep: result.review?.verdict === 'APPROVED'
          ? 'La PR fue aprobada. Se puede mergear.'
          : result.review?.verdict === 'REQUEST_CHANGES'
            ? `El Reviewer solicita cambios. ${(result.review?.issues || []).length} issues encontrados. Usa fix_review_issues para arreglarlos.`
            : null,
      };
    },
  },
};
