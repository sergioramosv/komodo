import { readStore, writeStore, calculateStats } from '../store.js';

export const statsTools = {
  get_review_brief: {
    description: 'Devuelve un resumen formateado de los patrones de error más frecuentes. Diseñado para inyectar en el prompt del Reviewer antes de cada review.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Número máximo de patrones a incluir. Default: 10',
        },
      },
      required: [],
    },
    handler: async ({ limit = 10 }) => {
      const store = readStore();

      // Filtrar solo errores y anti-patterns (no positivos ni style)
      const relevantPatterns = store.patterns
        .filter(p => p.type === 'error' || p.type === 'anti-pattern')
        .sort((a, b) => {
          // Ordenar: primero por severidad (high > medium > low), luego por frecuencia
          const severityOrder = { high: 3, medium: 2, low: 1 };
          const sevDiff = severityOrder[b.severity] - severityOrder[a.severity];
          if (sevDiff !== 0) return sevDiff;
          return b.frequency - a.frequency;
        })
        .slice(0, limit);

      if (relevantPatterns.length === 0) {
        return {
          brief: 'No hay patrones de error registrados aún. Esta es la primera review.',
          patternsCount: 0,
        };
      }

      // Formatear como texto legible para inyectar en el prompt
      const lines = relevantPatterns.map((p, i) => {
        const tags = p.tags.length > 0 ? ` [${p.tags.join(', ')}]` : '';
        const resolution = p.resolution ? ` → ${p.resolution}` : '';
        return `${i + 1}. [${p.severity.toUpperCase()}, x${p.frequency}]${tags} ${p.description}${resolution}`;
      });

      const brief = `TOP ERRORES FRECUENTES (presta especial atención a estos):\n${lines.join('\n')}`;

      return {
        brief,
        patterns: relevantPatterns,
        patternsCount: relevantPatterns.length,
      };
    },
  },

  record_review_outcome: {
    description: 'Registra el resultado de una review completa (passed/failed), incluyendo el número de ciclos coder↔reviewer que tomó.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'ID de la tarea',
        },
        prNumber: {
          type: 'number',
          description: 'Número de la PR',
        },
        outcome: {
          type: 'string',
          description: 'Resultado: passed (aprobada) o failed (rechazada/abandonada)',
          enum: ['passed', 'failed'],
        },
        cycles: {
          type: 'number',
          description: 'Número de ciclos coder↔reviewer que tomó (1 = aprobada a la primera)',
        },
        issuesFound: {
          type: 'number',
          description: 'Número total de issues encontrados en todas las rondas',
        },
        repo: {
          type: 'string',
          description: 'Repositorio en formato owner/repo (opcional)',
        },
      },
      required: ['taskId', 'prNumber', 'outcome', 'cycles'],
    },
    handler: async ({ taskId, prNumber, outcome, cycles, issuesFound = 0, repo }) => {
      const store = readStore();

      const record = {
        taskId,
        prNumber,
        outcome,
        cycles,
        issuesFound,
        repo: repo || null,
        date: new Date().toISOString(),
      };

      store.reviewOutcomes.push(record);
      writeStore(store);

      return {
        recorded: record,
        message: `Review outcome registrado: ${outcome} en ${cycles} ciclo(s)`,
      };
    },
  },

  get_stats: {
    description: 'Devuelve estadísticas completas del sistema de memoria: total reviews, pass rate, media de ciclos, errores más comunes por tag y severidad.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const store = readStore();
      const stats = calculateStats(store.reviewOutcomes);

      // Agrupar patrones por severidad
      const bySeverity = { high: 0, medium: 0, low: 0 };
      store.patterns.forEach(p => {
        bySeverity[p.severity] = (bySeverity[p.severity] || 0) + 1;
      });

      // Agrupar patrones por tipo
      const byType = {};
      store.patterns.forEach(p => {
        byType[p.type] = (byType[p.type] || 0) + 1;
      });

      // Top tags (por frecuencia acumulada)
      const tagFreq = {};
      store.patterns.forEach(p => {
        p.tags.forEach(t => {
          tagFreq[t] = (tagFreq[t] || 0) + p.frequency;
        });
      });
      const topTags = Object.entries(tagFreq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag, freq]) => ({ tag, frequency: freq }));

      return {
        reviews: stats,
        patterns: {
          total: store.patterns.length,
          bySeverity,
          byType,
        },
        topTags,
        recentOutcomes: store.reviewOutcomes.slice(-5),
      };
    },
  },
};
