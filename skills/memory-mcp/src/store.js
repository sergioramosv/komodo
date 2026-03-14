import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { PATTERNS_FILE, firebaseConfig } from './config.js';
import { getMemoryEntries, createMemoryEntry, updateMemoryEntry } from './firebase-memory.js';

/**
 * Motor de almacenamiento para memory/patterns.json
 * Estructura del archivo:
 * {
 *   "patterns": [...],
 *   "reviewOutcomes": [...]
 * }
 */

const EMPTY_STORE = {
  patterns: [],
  reviewOutcomes: [],
};

/**
 * Lee el store completo desde disco.
 * Si el archivo no existe, devuelve la estructura vacía.
 */
export function readStore() {
  try {
    if (!existsSync(PATTERNS_FILE)) {
      return structuredClone(EMPTY_STORE);
    }
    const raw = readFileSync(PATTERNS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return {
      patterns: Array.isArray(data.patterns) ? data.patterns : [],
      reviewOutcomes: Array.isArray(data.reviewOutcomes) ? data.reviewOutcomes : [],
    };
  } catch {
    return structuredClone(EMPTY_STORE);
  }
}

/**
 * Escribe el store a disco de forma atómica (tmp + rename).
 * Evita corrupción si el proceso muere a mitad de escritura.
 */
export function writeStore(data) {
  const tmpFile = PATTERNS_FILE + '.tmp';
  writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmpFile, PATTERNS_FILE);
}

/**
 * Busca un patrón similar por descripción (coincidencia parcial case-insensitive).
 * Devuelve el patrón si lo encuentra, null si no.
 */
export function findSimilarPattern(patterns, description) {
  const descLower = description.toLowerCase();
  // Buscar coincidencia exacta o que una contenga a la otra
  return patterns.find(p => {
    const pLower = p.description.toLowerCase();
    return pLower === descLower || pLower.includes(descLower) || descLower.includes(pLower);
  }) || null;
}

/**
 * Devuelve todas las entries disponibles para búsqueda semántica.
 * Si USE_FIREBASE_MEMORY=true, lee desde Firebase. Si no, lee desde file store.
 * Cada entry debe tener al menos: { id, description, embedding, module? }
 * @param {string} [projectId]
 * @returns {Promise<Array<{id: string, description: string, embedding: number[]|null, module?: string}>>}
 */
export async function getEntriesForSearch(projectId = 'default') {
  if (firebaseConfig.useFirebaseMemory && firebaseConfig.serviceAccountPath && firebaseConfig.databaseURL) {
    try {
      const entries = await getMemoryEntries(projectId, 'patterns');
      return entries.map(e => ({
        id: e.id,
        description: e.text || e.description || '',
        embedding: Array.isArray(e.embedding) ? e.embedding : null,
        module: e.module || null,
        type: e.type || null,
        severity: e.severity || null,
        frequency: e.frequency || null,
      }));
    } catch (err) {
      console.error('[store] Error leyendo Firebase para search, fallback a file store:', err.message);
    }
  }

  const store = readStore();
  return store.patterns.map(p => ({
    id: p.id,
    description: p.description,
    embedding: Array.isArray(p.embedding) ? p.embedding : null,
    module: p.module || null,
    type: p.type || null,
    severity: p.severity || null,
    frequency: p.frequency || null,
  }));
}

/**
 * Añade o actualiza el embedding de una entry existente.
 * Si USE_FIREBASE_MEMORY=true, actualiza en Firebase. Si no, actualiza en file store.
 * @param {string} entryId
 * @param {number[]} embedding
 * @param {string} [projectId]
 * @returns {Promise<void>}
 */
export async function addOrUpdateEntryEmbedding(entryId, embedding, projectId = 'default') {
  if (firebaseConfig.useFirebaseMemory && firebaseConfig.serviceAccountPath && firebaseConfig.databaseURL) {
    try {
      await updateMemoryEntry(projectId, 'patterns', entryId, { embedding });
      return;
    } catch (err) {
      console.error('[store] Error actualizando embedding en Firebase, fallback a file store:', err.message);
    }
  }

  const store = readStore();
  const pattern = store.patterns.find(p => p.id === entryId);
  if (pattern) {
    pattern.embedding = embedding;
    writeStore(store);
  }
}

/**
 * Calcula estadísticas básicas de los review outcomes.
 */
export function calculateStats(reviewOutcomes) {
  if (reviewOutcomes.length === 0) {
    return {
      totalReviews: 0,
      passed: 0,
      failed: 0,
      passRate: 0,
      avgCycles: 0,
    };
  }

  const passed = reviewOutcomes.filter(r => r.outcome === 'passed').length;
  const failed = reviewOutcomes.filter(r => r.outcome === 'failed').length;
  const totalCycles = reviewOutcomes.reduce((sum, r) => sum + (r.cycles || 1), 0);

  return {
    totalReviews: reviewOutcomes.length,
    passed,
    failed,
    passRate: Math.round((passed / reviewOutcomes.length) * 100),
    avgCycles: Math.round((totalCycles / reviewOutcomes.length) * 10) / 10,
  };
}
