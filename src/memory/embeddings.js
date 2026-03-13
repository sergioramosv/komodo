import { pipeline } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

let pipelineInstance = null;

/**
 * Returns (and caches) the feature-extraction pipeline.
 * @returns {Promise<Function>}
 */
async function getEmbeddingPipeline() {
      if (!pipelineInstance) {
            pipelineInstance = await pipeline('feature-extraction', MODEL_NAME, { revision: 'main' });
      }
      return pipelineInstance;
}

/**
 * Generates a 384-dimensional embedding for the given text.
 * Runs on CPU with no GPU required.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
      const extractor = await getEmbeddingPipeline();
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
}

/**
 * Computes cosine similarity between two embedding vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} value in [-1, 1]
 */
function cosineSimilarity(a, b) {
      if (a.length !== b.length) {
            throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
      }
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      if (denom === 0) return 0;
      return dot / denom;
}

export { embed, cosineSimilarity, getEmbeddingPipeline, EMBEDDING_DIM };
