import { runGh } from '../gh-cli.js';

export const mergeTools = {
  merge_pr: {
    description: 'Mergea una Pull Request aprobada. Soporta merge, squash y rebase.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repositorio en formato owner/repo',
        },
        prNumber: {
          type: 'number',
          description: 'Número de la PR',
        },
        mergeMethod: {
          type: 'string',
          description: 'Método de merge: merge, squash o rebase. Default: squash',
          enum: ['merge', 'squash', 'rebase'],
        },
        deleteBranch: {
          type: 'boolean',
          description: 'Eliminar la branch después de mergear. Default: true',
        },
      },
      required: ['repo', 'prNumber'],
    },
    handler: async ({ repo, prNumber, mergeMethod = 'squash', deleteBranch = true }) => {
      const args = [
        'pr', 'merge', String(prNumber),
        '--repo', repo,
        `--${mergeMethod}`,
      ];

      if (deleteBranch) {
        args.push('--delete-branch');
      }

      const output = runGh(args);

      return {
        repo,
        prNumber,
        mergeMethod,
        branchDeleted: deleteBranch,
        message: `PR #${prNumber} mergeada con ${mergeMethod}`,
        output,
      };
    },
  },

  close_pr: {
    description: 'Cierra una Pull Request sin mergear.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repositorio en formato owner/repo',
        },
        prNumber: {
          type: 'number',
          description: 'Número de la PR',
        },
        comment: {
          type: 'string',
          description: 'Comentario explicando por qué se cierra (opcional)',
        },
      },
      required: ['repo', 'prNumber'],
    },
    handler: async ({ repo, prNumber, comment }) => {
      // Añadir comentario si se proporciona
      if (comment) {
        runGh([
          'pr', 'comment', String(prNumber),
          '--repo', repo,
          '--body', comment,
        ]);
      }

      runGh([
        'pr', 'close', String(prNumber),
        '--repo', repo,
      ]);

      return {
        repo,
        prNumber,
        comment: comment || null,
        message: `PR #${prNumber} cerrada sin mergear`,
      };
    },
  },
};
