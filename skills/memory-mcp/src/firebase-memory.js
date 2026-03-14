import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { firebaseConfig } from './config.js';

const APP_NAME = 'memory-mcp';

export const COLLECTIONS = /** @type {const} */ ({
  PATTERNS: 'patterns',
  DECISIONS: 'decisions',
  LESSONS: 'lessons',
});

const VALID_COLLECTIONS = new Set(Object.values(COLLECTIONS));

/**
 * @param {string} collection
 */
function assertValidCollection(collection) {
  if (!VALID_COLLECTIONS.has(collection)) {
    throw new Error(
      `Colección inválida: "${collection}". Valores permitidos: ${[...VALID_COLLECTIONS].join(', ')}`
    );
  }
}

/** @type {admin.database.Database|null} */
let db = null;

/**
 * Inicializa (o reutiliza) la app de Firebase con name 'memory-mcp'.
 * @returns {admin.database.Database}
 */
export function getMemoryDb() {
  if (db) return db;

  if (!firebaseConfig.useFirebaseMemory) {
    throw new Error('Firebase memory no está habilitado (USE_FIREBASE_MEMORY=true requerido)');
  }
  if (!firebaseConfig.serviceAccountPath || !firebaseConfig.databaseURL) {
    throw new Error('Faltan variables de entorno Firebase: GOOGLE_APPLICATION_CREDENTIALS y FIREBASE_DATABASE_URL requeridas');
  }

  let existingApp = null;
  try {
    existingApp = admin.app(APP_NAME);
  } catch {
    // App no existe todavía
  }

  if (!existingApp) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(readFileSync(firebaseConfig.serviceAccountPath, 'utf8'));
    } catch (err) {
      throw new Error(
        `No se pudo leer o parsear el service account en "${firebaseConfig.serviceAccountPath}": ${err.message}`
      );
    }
    admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount), databaseURL: firebaseConfig.databaseURL },
      APP_NAME
    );
  }

  db = admin.app(APP_NAME).database();
  return db;
}

/**
 * Elimina claves undefined para que RTDB no las rechace.
 * @param {Record<string, unknown>} data
 * @returns {Record<string, unknown>}
 */
function sanitize(data) {
  return JSON.parse(JSON.stringify(data, (_, v) => (v === undefined ? null : v)));
}

/**
 * Crea una entry en /memory/{projectId}/{collection}/{id}.
 * @param {string} projectId
 * @param {'patterns'|'decisions'|'lessons'} collection
 * @param {{ text: string, embedding?: number[], severity?: string, frequency?: number, relatedFiles?: string[], lastSeen?: string }} data
 * @returns {Promise<{ id: string }>}
 */
export async function createMemoryEntry(projectId, collection, data) {
  assertValidCollection(collection);
  const ref = getMemoryDb().ref(`memory/${projectId}/${collection}`).push();
  const entry = sanitize({
    text: data.text,
    embedding: data.embedding ?? null,
    severity: data.severity ?? null,
    frequency: data.frequency ?? 0,
    relatedFiles: data.relatedFiles ?? [],
    lastSeen: data.lastSeen ?? new Date().toISOString(),
    type: data.type ?? null,
  });
  await ref.set(entry);
  return { id: ref.key };
}

/**
 * Obtiene todas las entries de una colección.
 * @param {string} projectId
 * @param {'patterns'|'decisions'|'lessons'} collection
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function getMemoryEntries(projectId, collection) {
  assertValidCollection(collection);
  const snap = await getMemoryDb().ref(`memory/${projectId}/${collection}`).once('value');
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, val]) => ({ id, ...val }));
}

/**
 * Obtiene una entry por ID.
 * @param {string} projectId
 * @param {'patterns'|'decisions'|'lessons'} collection
 * @param {string} id
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function getMemoryEntry(projectId, collection, id) {
  assertValidCollection(collection);
  const snap = await getMemoryDb().ref(`memory/${projectId}/${collection}/${id}`).once('value');
  if (!snap.exists()) return null;
  return { id, ...snap.val() };
}

/**
 * Actualiza campos de una entry existente.
 * @param {string} projectId
 * @param {'patterns'|'decisions'|'lessons'} collection
 * @param {string} id
 * @param {Record<string, unknown>} data
 * @returns {Promise<void>}
 */
export async function updateMemoryEntry(projectId, collection, id, data) {
  assertValidCollection(collection);
  await getMemoryDb()
    .ref(`memory/${projectId}/${collection}/${id}`)
    .update(sanitize(data));
}

/**
 * Elimina una entry.
 * @param {string} projectId
 * @param {'patterns'|'decisions'|'lessons'} collection
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteMemoryEntry(projectId, collection, id) {
  assertValidCollection(collection);
  await getMemoryDb().ref(`memory/${projectId}/${collection}/${id}`).remove();
}
