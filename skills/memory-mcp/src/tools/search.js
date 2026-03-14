import { embed, EMBEDDING_DIM } from '../vertex-embeddings.js';
import { getEntriesForSearch } from '../store.js';

/**
 * Calcula el cosine similarity entre dos vectores.
 * Devuelve 0 si alguno es un vector de ceros.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} Valor entre -1 y 1
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Determina si dos módulos son el mismo (comparación case-insensitive, ignorando null/undefined).
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {boolean}
 */
function sameModule(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export const searchTools = {
  get_relevant_memory: {
    description: 'Busca en memoria las entries más relevantes para una consulta usando cosine similarity sobre embeddings Vertex AI. Aplica boost de 30% para entries del mismo módulo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Texto de búsqueda semántica (ej: "auth middleware session management")',
        },
        module: {
          type: 'string',
          description: 'Módulo actual para aplicar boost de similitud (opcional)',
        },
        topK: {
          type: 'number',
          description: 'Número de resultados a devolver. Default: 5',
        },
        projectId: {
          type: 'string',
          description: 'Project ID para Firebase. Default: "default"',
        },
      },
      required: ['query'],
    },
    handler: async ({ query, module: queryModule, topK = 5, projectId = 'default' }) => {
      const queryEmbedding = await embed(query);

      const isZeroVector = queryEmbedding.every(v => v === 0);
      if (isZeroVector) {
        return {
          results: [],
          total: 0,
          message: 'No se pudo generar embedding para la consulta (Vertex AI no disponible).',
        };
      }

      const entries = await getEntriesForSearch(projectId);

      const scored = [];
      for (const entry of entries) {
        if (!Array.isArray(entry.embedding) || entry.embedding.length !== EMBEDDING_DIM) {
          continue;
        }

        const isEntryZero = entry.embedding.every(v => v === 0);
        if (isEntryZero) continue;

        let score = cosineSimilarity(queryEmbedding, entry.embedding);

        // Boost de 30% para entries del mismo módulo
        if (sameModule(queryModule, entry.module)) {
          score = Math.min(1, score * 1.3);
        }

        scored.push({ ...entry, score });
      }

      // Ordenar por score descendente y tomar top K
      scored.sort((a, b) => b.score - a.score);
      const results = scored.slice(0, topK).map(({ id, description, module, score }) => ({
        id,
        description,
        module: module || null,
        score: Math.round(score * 10000) / 10000,
      }));

      return {
        results,
        total: results.length,
        totalSearched: entries.length,
      };
    },
  },
};
