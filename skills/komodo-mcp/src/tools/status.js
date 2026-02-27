import { config } from '../config.js';
import { validateConfig as validateKomodoConfig } from '../../../../src/config.js';

export const statusTools = {
  get_komodo_status: {
    description: 'Devuelve la configuracion actual de Komodo y el estado de salud: CLIs asignados a cada agente, proyecto por defecto, auto-merge, max review cycles, y si hay errores de configuracion. Operacion instantanea.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const errors = validateKomodoConfig({ dryRun: false });

      return {
        config: {
          projectId: config.defaultProjectId || '(no configurado)',
          agents: {
            planner: config.cliPlanner,
            coder: config.cliCoder,
            reviewer: config.cliReviewer,
          },
          autoMerge: config.autoMerge,
          maxReviewCycles: config.maxReviewCycles,
          userId: config.defaultUserId || '(no configurado)',
          userName: config.defaultUserName || '(no configurado)',
        },
        health: {
          healthy: errors.length === 0,
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    },
  },
};
