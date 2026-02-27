import { runGh } from '../gh-cli.js';

export const pullTools = {
  create_pr: {
    description: 'Crea un Pull Request en un repositorio.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repositorio en formato owner/repo',
        },
        title: {
          type: 'string',
          description: 'Título de la PR',
        },
        body: {
          type: 'string',
          description: 'Descripción/body de la PR (markdown)',
        },
        head: {
          type: 'string',
          description: 'Branch con los cambios (ej: feature/login)',
        },
        base: {
          type: 'string',
          description: 'Branch destino. Default: main',
        },
      },
      required: ['repo', 'title', 'head'],
    },
    handler: async ({ repo, title, body = '', head, base = 'main' }) => {
      const args = [
        'pr', 'create',
        '--repo', repo,
        '--title', title,
        '--body', body,
        '--head', head,
        '--base', base,
        '--json', 'number,url,title,state',
      ];

      const result = runGh(args, { json: true });

      return {
        number: result.number,
        url: result.url,
        title: result.title,
        state: result.state,
        head,
        base,
        repo,
        message: `PR #${result.number} creada: ${result.url}`,
      };
    },
  },

  get_pr: {
    description: 'Obtiene los detalles completos de una Pull Request.',
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
      const result = runGh([
        'pr', 'view', String(prNumber),
        '--repo', repo,
        '--json', 'number,url,title,body,state,author,headRefName,baseRefName,additions,deletions,changedFiles,createdAt,reviewDecision',
      ], { json: true });

      return {
        number: result.number,
        url: result.url,
        title: result.title,
        body: result.body,
        state: result.state,
        author: result.author?.login || result.author,
        headBranch: result.headRefName,
        baseBranch: result.baseRefName,
        additions: result.additions,
        deletions: result.deletions,
        changedFiles: result.changedFiles,
        createdAt: result.createdAt,
        reviewDecision: result.reviewDecision,
      };
    },
  },

  get_pr_diff: {
    description: 'Obtiene el diff completo de una Pull Request como texto.',
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
      const diff = runGh([
        'pr', 'diff', String(prNumber),
        '--repo', repo,
      ]);

      return {
        repo,
        prNumber,
        diff,
        lines: diff.split('\n').length,
      };
    },
  },

  list_pr_files: {
    description: 'Lista los archivos cambiados en una Pull Request con su estado (added/modified/deleted).',
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
      const result = runGh([
        'api', `repos/${repo}/pulls/${prNumber}/files`,
        '--jq', '.[] | {filename, status, additions, deletions, changes}',
      ]);

      // Parsear líneas JSONL
      const files = result
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
        files,
        totalFiles: files.length,
        totalAdditions: files.reduce((sum, f) => sum + (f.additions || 0), 0),
        totalDeletions: files.reduce((sum, f) => sum + (f.deletions || 0), 0),
      };
    },
  },
};
