import { createHash } from 'crypto';
import { GoogleAuth } from 'google-auth-library';
import { vertexConfig } from './config.js';

export const EMBEDDING_DIM = vertexConfig.embeddingDim;

/** @type {Map<string, number[]>} */
const cache = new Map();

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/**
 * Genera un embedding de 768 dims para el texto dado usando Vertex AI text-embedding-004.
 * Cachea por hash SHA-256 del texto. Fallback a array de 768 ceros si falla.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  const hash = createHash('sha256').update(text).digest('hex');

  if (cache.has(hash)) {
    return cache.get(hash);
  }

  try {
    const project = vertexConfig.project;
    const location = vertexConfig.location;
    const model = vertexConfig.model;

    if (!project) {
      throw new Error('GOOGLE_CLOUD_PROJECT no está configurado');
    }

    const client = await auth.getClient();
    const token = await client.getAccessToken();

    if (!token.token) {
      throw new Error('No se pudo obtener access token de Google Auth (token es null)');
    }

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{ content: text }],
        parameters: { outputDimensionality: EMBEDDING_DIM },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Vertex AI error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const embedding = data.predictions?.[0]?.embeddings?.values;

    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
      throw new Error('Respuesta inesperada de Vertex AI: embedding inválido');
    }

    cache.set(hash, embedding);
    return embedding;
  } catch (err) {
    console.error('[vertex-embeddings] Error generando embedding, usando fallback:', err.message);
    const fallback = new Array(EMBEDDING_DIM).fill(0);
    // No cachear el fallback de ceros: si el fallo es temporal, el próximo intento debe reintentar
    return fallback;
  }
}
