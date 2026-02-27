import { reviewLoop } from '../../../../src/cycle/review-loop.js';

export const cycleTools = {
  run_review_loop: {
    description: 'Ejecuta el bucle completo Reviewer <-> Coder: el Reviewer revisa la PR, si encuentra problemas el Coder los arregla, y se re-revisa. Hasta MAX_REVIEW_CYCLES rondas o hasta APPROVED. Operacion larga: 2-10 minutos.',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'number',
          description: 'Numero de la PR.',
        },
        repo: {
          type: 'string',
          description: 'Repositorio en formato owner/repo.',
        },
        taskSpec: {
          type: 'object',
          description: 'Especificacion de la tarea.',
        },
        cwd: {
          type: 'string',
          description: 'Directorio del repositorio.',
        },
      },
      required: ['prNumber', 'repo', 'taskSpec'],
    },
    handler: async ({ prNumber, repo, taskSpec, cwd }) => {
      const result = await reviewLoop({ prNumber, repo, taskSpec, cwd });

      return {
        approved: result.approved,
        cycles: result.cycles,
        finalReview: result.finalReview || null,
        error: result.error || null,
        nextStep: result.approved
          ? 'La PR fue aprobada. Se puede mergear.'
          : `La PR no fue aprobada despues de ${result.cycles} ciclos.`,
      };
    },
  },
};
