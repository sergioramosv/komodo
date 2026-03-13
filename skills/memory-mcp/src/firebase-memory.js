import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { firebaseMemoryConfig, isFirebaseEnabled } from './firebase-config.js';

const APP_NAME = 'memory-mcp';

/** @type {admin.database.Database|null} */
let db = null;

/**
 * Inicializa (o reutiliza) la app de Firebase con name 'memory-mcp'.
 * @returns {admin.database.Database}
 */
export function getMemoryDb() {
  if (db) return db;

  if (!isFirebaseEnabled()) {
    throw new Error('Firebase memory no está habilitado (USE_FIREBASE_MEMORY=true requerido)');
  }

  let existingApp = null;
  try {
    existingApp = admin.app(APP_NAME);
  } catch {
    // App no existe todavía
  }

  if (!existingApp) {
    const credential = admin.credential.cert(
      JSON.parse(readFileSync(firebaseMemoryConfig.credentialsPath, 'utf8'))
    );
    admin.initializeApp(
      { credential, databaseURL: firebaseMemoryConfig.databaseURL },
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
export async function createEntry(projectId, collection, data) {
  const ref = getMemoryDb().ref(`memory/${projectId}/${collection}`).push();
  const entry = sanitize({
    text: data.text,
    embedding: data.embedding ?? null,
    severity: data.severity ?? null,
    frequency: data.frequency ?? 0,
    relatedFiles: data.relatedFiles ?? [],
    lastSeen: data.lastSeen ?? new Date().toISOString(),
  });
  await ref.set(entry);
  return { id: ref.key };
}

/**
 * Obtiene una entry por ID.
 * @param {string} projectId
 * @param {string} collection
 * @param {string} id
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function getEntry(projectId, collection, id) {
  const snap = await getMemoryDb().ref(`memory/${projectId}/${collection}/${id}`).once('value');
  if (!snap.exists()) return null;
  return { id, ...snap.val() };
}

/**
 * Obtiene todas las entries de una colección.
 * @param {string} projectId
 * @param {string} collection
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function getAllEntries(projectId, collection) {
  const snap = await getMemoryDb().ref(`memory/${projectId}/${collection}`).once('value');
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, val]) => ({ id, ...val }));
}

/**
 * Actualiza campos de una entry existente.
 * @param {string} projectId
 * @param {string} collection
 * @param {string} id
 * @param {Record<string, unknown>} data
 * @returns {Promise<void>}
 */
export async function updateEntry(projectId, collection, id, data) {
  await getMemoryDb()
    .ref(`memory/${projectId}/${collection}/${id}`)
    .update(sanitize(data));
}

/**
 * Elimina una entry.
 * @param {string} projectId
 * @param {string} collection
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteEntry(projectId, collection, id) {
  await getMemoryDb().ref(`memory/${projectId}/${collection}/${id}`).remove();
}

/**
 * Consulta entries filtrando por un campo (orderByChild).
 * @param {string} projectId
 * @param {string} collection
 * @param {{ field: string, value: string|number|boolean }} filters
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function queryEntries(projectId, collection, filters) {
  let query = getMemoryDb().ref(`memory/${projectId}/${collection}`);

  if (filters?.field && filters.value !== undefined) {
    query = query.orderByChild(filters.field).equalTo(filters.value);
  }

  const snap = await query.once('value');
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, val]) => ({ id, ...val }));
}
