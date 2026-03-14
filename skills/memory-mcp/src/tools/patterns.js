import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore, findSimilarPattern, addOrUpdateEntryEmbedding } from '../store.js';
import { embed } from '../vertex-embeddings.js';
import { semanticSearch } from './search.js';
import { createMemoryEntry } from '../firebase-memory.js';

export const patternTools = {
  record_pattern: {
    description: 'Registra un patrón de error o antipatrón encontrado en una review. Si ya existe uno similar, incrementa su frecuencia en vez de duplicar.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Tipo de patrón: error, anti-pattern, style o positive',
          enum: ['error', 'anti-pattern', 'style', 'positive'],
        },
        description: {
          type: 'string',
          description: 'Descripción del patrón (ej: "No maneja errores después de fetch")',
        },
        tags: {
          type: 'array',
          description: 'Tags para categorizar (ej: ["error-handling", "async"])',
          items: { type: 'string' },
        },
        severity: {
          type: 'string',
          description: 'Severidad: high, medium o low',
          enum: ['high', 'medium', 'low'],
        },
        resolution: {
          type: 'string',
          description: 'Cómo resolver o evitar este patrón (ej: "Siempre envolver fetch en try/catch")',
        },
        taskId: {
          type: 'string',
          description: 'ID de la tarea donde se encontró (opcional)',
        },
        prNumber: {
          type: 'number',
          description: 'Número de la PR donde se encontró (opcional)',
        },
        projectId: {
          type: 'string',
          description: 'Project ID para guardar en Firebase con embedding (opcional)',
        },
      },
      required: ['type', 'description', 'severity'],
    },
    handler: async ({ type, description, tags = [], severity, resolution = '', taskId, prNumber, projectId }) => {
      const store = readStore();
      const today = new Date().toISOString().split('T')[0];

      // Buscar patrón similar existente
      const existing = findSimilarPattern(store.patterns, description);

      if (existing) {
        // Incrementar frecuencia y actualizar lastSeen
        existing.frequency += 1;
        existing.lastSeen = today;
        // Mergear tags nuevos
        if (tags.length > 0) {
          existing.tags = [...new Set([...existing.tags, ...tags])];
        }
        // Actualizar resolución si se proporciona una nueva
        if (resolution) {
          existing.resolution = resolution;
        }
        // Actualizar severidad si sube
        const severityOrder = { low: 1, medium: 2, high: 3 };
        if (severityOrder[severity] > severityOrder[existing.severity]) {
          existing.severity = severity;
        }

        writeStore(store);
        return {
          action: 'updated',
          pattern: existing,
          message: `Patrón existente actualizado (frecuencia: ${existing.frequency})`,
        };
      }

      // Crear nuevo patrón
      const newPattern = {
        id: uuidv4(),
        type,
        description,
        tags,
        severity,
        resolution,
        frequency: 1,
        firstSeen: today,
        lastSeen: today,
        taskId: taskId || null,
        prNumber: prNumber || null,
      };

      if (projectId) {
        // Guardar SOLO en Firebase; si falla, guardar localmente como fallback
        try {
          const embedding = await embed(description);
          await createMemoryEntry(projectId, 'patterns', {
            text: description,
            embedding,
            severity,
            frequency: 1,
            relatedFiles: [],
            lastSeen: today,
            type,
          });
        } catch (err) {
          console.error('[patterns] Error guardando en Firebase, usando store local:', err.message);
          store.patterns.push(newPattern);
          writeStore(store);
        }
      } else {
        // Guardar localmente y generar embedding en background
        store.patterns.push(newPattern);
        writeStore(store);
        embed(description).then(embedding => {
          return addOrUpdateEntryEmbedding(newPattern.id, embedding);
        }).catch(err => {
          console.error('[patterns] Error generando embedding en background:', err.message);
        });
      }

      return {
        action: 'created',
        pattern: newPattern,
        message: `Nuevo patrón registrado: "${description}"`,
      };
    },
  },

  query_patterns: {
    description: 'Busca patrones por tags, tipo, severidad o texto libre. Los resultados se devuelven ordenados por frecuencia (más frecuentes primero). Si se proporcionan projectId y semanticQuery, usa búsqueda semántica por embeddings.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filtrar por tipo',
          enum: ['error', 'anti-pattern', 'style', 'positive'],
        },
        severity: {
          type: 'string',
          description: 'Filtrar por severidad',
          enum: ['high', 'medium', 'low'],
        },
        tags: {
          type: 'array',
          description: 'Filtrar por tags (coincide si tiene al menos uno)',
          items: { type: 'string' },
        },
        query: {
          type: 'string',
          description: 'Texto libre para buscar en descripción y resolución',
        },
        limit: {
          type: 'number',
          description: 'Máximo de resultados. Default: 20',
        },
        projectId: {
          type: 'string',
          description: 'Project ID para búsqueda semántica en Firebase (requiere semanticQuery)',
        },
        semanticQuery: {
          type: 'string',
          description: 'Texto para búsqueda semántica por embeddings (requiere projectId)',
        },
      },
      required: [],
    },
    handler: async ({ type, severity, tags = [], query, limit = 20, projectId, semanticQuery }) => {
      // Búsqueda semántica cuando se proporcionan projectId y semanticQuery
      if (projectId && semanticQuery) {
        try {
          const searchResult = await semanticSearch({
            query: semanticQuery,
            topK: limit,
            projectId,
            type,
          });

          if (searchResult.message) {
            return {
              patterns: [],
              total: 0,
              message: searchResult.message,
            };
          }

          return {
            patterns: searchResult.results,
            total: searchResult.total,
            totalSearched: searchResult.totalSearched,
            searchMode: 'semantic',
          };
        } catch (err) {
          console.error('[query_patterns] Error en búsqueda semántica:', err.message);
          // Fallback a búsqueda por texto
        }
      }

      const store = readStore();
      let results = [...store.patterns];

      // Filtrar por tipo
      if (type) {
        results = results.filter(p => p.type === type);
      }

      // Filtrar por severidad
      if (severity) {
        results = results.filter(p => p.severity === severity);
      }

      // Filtrar por tags (al menos uno debe coincidir)
      if (tags.length > 0) {
        results = results.filter(p =>
          p.tags.some(t => tags.includes(t))
        );
      }

      // Filtrar por texto libre
      if (query) {
        const q = query.toLowerCase();
        results = results.filter(p =>
          p.description.toLowerCase().includes(q) ||
          (p.resolution && p.resolution.toLowerCase().includes(q))
        );
      }

      // Ordenar por frecuencia descendente
      results.sort((a, b) => b.frequency - a.frequency);

      // Limitar resultados
      results = results.slice(0, limit);

      return {
        patterns: results,
        total: results.length,
        totalInStore: store.patterns.length,
        searchMode: 'text',
      };
    },
  },
};
