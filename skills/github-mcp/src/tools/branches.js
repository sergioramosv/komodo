import { runGh, runGit, runGhApi } from '../gh-cli.js';

export const branchTools = {
  create_branch: {
    description: 'Crea una nueva branch en un repositorio desde una branch base (default: main).',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repositorio en formato owner/repo (ej: SergioRVDev/komodo)',
        },
        branchName: {
          type: 'string',
          description: 'Nombre de la nueva branch (ej: feature/task-123-login)',
        },
        baseBranch: {
          type: 'string',
          description: 'Branch base desde la que crear. Default: main',
        },
        cwd: {
          type: 'string',
          description: 'Directorio de trabajo del repositorio local (opcional)',
        },
      },
      required: ['repo', 'branchName'],
    },
    handler: async ({ repo, branchName, baseBranch = 'main', cwd }) => {
      // Si tenemos cwd (repo clonado local), usamos git directamente
      if (cwd) {
        runGit(['fetch', 'origin'], { cwd });
        runGit(['checkout', '-b', branchName, `origin/${baseBranch}`], { cwd });
        return {
          branch: branchName,
          baseBranch,
          repo,
          method: 'local',
          message: `Branch "${branchName}" creada desde "${baseBranch}" en ${cwd}`,
        };
      }

      // Sin repo local: crear branch remota via gh api
      // Primero obtener el SHA de la branch base
      const baseRef = runGh(
        ['api', `repos/${repo}/git/ref/heads/${baseBranch}`, '--jq', '.object.sha'],
      );

      if (!baseRef) {
        throw new Error(`Branch base "${baseBranch}" no encontrada en ${repo}`);
      }

      // Crear la referencia de la nueva branch
      runGhApi(`repos/${repo}/git/refs`, {
        method: 'POST',
        fields: [
          `ref=refs/heads/${branchName}`,
          `sha=${baseRef}`,
        ],
      });

      return {
        branch: branchName,
        baseBranch,
        repo,
        method: 'remote',
        message: `Branch "${branchName}" creada desde "${baseBranch}" en ${repo}`,
      };
    },
  },

  list_branches: {
    description: 'Lista las branches de un repositorio. Opcionalmente filtra por patrón.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repositorio en formato owner/repo',
        },
        pattern: {
          type: 'string',
          description: 'Patrón para filtrar branches (ej: feature/)',
        },
      },
      required: ['repo'],
    },
    handler: async ({ repo, pattern }) => {
      const branches = runGh(
        ['api', `repos/${repo}/branches`, '--jq', '.[].name'],
      );

      const branchList = branches
        .split('\n')
        .filter(b => b.trim())
        .filter(b => !pattern || b.includes(pattern));

      return {
        repo,
        branches: branchList,
        count: branchList.length,
        filter: pattern || null,
      };
    },
  },
};
