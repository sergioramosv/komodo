import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..', '..');

export const MEMORY_DIR = resolve(ROOT_DIR, 'memory');
export const PATTERNS_FILE = resolve(MEMORY_DIR, 'patterns.json');

export const firebaseConfig = {
  serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || null,
  databaseURL: process.env.FIREBASE_DATABASE_URL || null,
  useFirebaseMemory: process.env.USE_FIREBASE_MEMORY === 'true',
};

export const vertexConfig = {
  project: process.env.GOOGLE_CLOUD_PROJECT || null,
  location: process.env.VERTEX_LOCATION || 'us-central1',
  model: 'text-embedding-004',
  embeddingDim: 768,
};

/**
 * Valida que el directorio de memoria exista (lo crea si no).
 * Si USE_FIREBASE_MEMORY=true, advierte si faltan variables Firebase (no fatal).
 * @returns {string[]} Array de errores (vacío si todo OK)
 */
export function validateConfig() {
  const errors = [];

  try {
    if (!existsSync(MEMORY_DIR)) {
      mkdirSync(MEMORY_DIR, { recursive: true });
    }
  } catch (err) {
    errors.push(`No se pudo crear el directorio de memoria (${MEMORY_DIR}): ${err.message}`);
  }

  if (firebaseConfig.useFirebaseMemory) {
    if (!firebaseConfig.serviceAccountPath) {
      console.warn('[memory-mcp] WARNING: USE_FIREBASE_MEMORY=true pero GOOGLE_APPLICATION_CREDENTIALS no está definida. Firebase deshabilitado.');
    }
    if (!firebaseConfig.databaseURL) {
      console.warn('[memory-mcp] WARNING: USE_FIREBASE_MEMORY=true pero FIREBASE_DATABASE_URL no está definida. Firebase deshabilitado.');
    }
  }

  return errors;
}
