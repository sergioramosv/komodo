import { runGh, runGhApi } from '../gh-cli.js';

export const reviewTools = {
  create_review: {
    description: 'Envía una review a una Pull Request: APPROVE, REQUEST_CHANGES o COMMENT. Soporta comentarios inline por archivo y línea.',
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
        event: {
          type: 'string',
          description: 'Tipo de review: APPROVE, REQUEST_CHANGES o COMMENT',
          enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
        },
        body: {
          type: 'string',
          description: 'Comentario general de la review',
        },
        comments: {
          type: 'array',
          description: 'Comentarios inline por archivo (opcional)',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Ruta del archivo (ej: src/index.js)',
              },
              line: {
                type: 'number',
                description: 'Número de línea en el diff',
              },
              body: {
                type: 'string',
                description: 'Texto del comentario',
              },
            },
            required: ['path', 'body'],
          },
        },
      },
      required: ['repo', 'prNumber', 'event', 'body'],
    },
    handler: async ({ repo, prNumber, event, body, comments = [] }) => {
      // Construir el payload para la API de GitHub
      const payload = {
        event,
        body,
      };

      // Añadir comentarios inline si los hay
      if (comments.length > 0) {
        payload.comments = comments.map(c => ({
          path: c.path,
          line: c.line || 1,
          body: c.body,
        }));
      }

      const result = runGhApi(`repos/${repo}/pulls/${prNumber}/reviews`, {
        method: 'POST',
        fields: [
          `event=${event}`,
          `body=${body}`,
        ],
      });

      // Si hay comentarios inline, añadirlos por separado (más fiable)
      if (comments.length > 0) {
        for (const comment of comments) {
          try {
            runGhApi(`repos/${repo}/pulls/${prNumber}/comments`, {
              method: 'POST',
              fields: [
                `body=${comment.body}`,
                `path=${comment.path}`,
                `line=${comment.line || 1}`,
                `side=RIGHT`,
              ],
            });
          } catch {
            // Comentarios inline pueden fallar si la línea no está en el diff
          }
        }
      }

      return {
        repo,
        prNumber,
        event,
        body,
        inlineComments: comments.length,
        reviewId: result?.id,
        message: `Review ${event} enviada a PR #${prNumber}`,
      };
    },
  },

  list_pr_comments: {
    description: 'Lista todos los comentarios de review de una Pull Request.',
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
      },
      required: ['repo', 'prNumber'],
    },
    handler: async ({ repo, prNumber }) => {
      // Obtener reviews
      const reviews = runGh([
        'api', `repos/${repo}/pulls/${prNumber}/reviews`,
        '--jq', '.[] | {id, state, body, user: .user.login, submittedAt: .submitted_at}',
      ]);

      const reviewList = reviews
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try { return JSON.parse(line); }
          catch { return null; }
        })
        .filter(Boolean);

      // Obtener comentarios de review (inline)
      const comments = runGh([
        'api', `repos/${repo}/pulls/${prNumber}/comments`,
        '--jq', '.[] | {id, path, line, body, user: .user.login, createdAt: .created_at}',
      ]);

      const commentList = comments
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try { return JSON.parse(line); }
          catch { return null; }
        })
        .filter(Boolean);

      return {
        repo,
        prNumber,
        reviews: reviewList,
        inlineComments: commentList,
        totalReviews: reviewList.length,
        totalInlineComments: commentList.length,
      };
    },
  },
};
