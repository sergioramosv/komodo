import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../../');
const QUEUE_PATH = resolve(ROOT_DIR, '.komodo/offline-queue.json');

/**
 * Persistent local JSON queue for pending Firebase operations during offline mode.
 *
 * Persists to .komodo/offline-queue.json and drains when Firebase recovers.
 */
class OfflineQueue {
  constructor() {
    /** @type {Array<{id: string, operation: object, enqueuedAt: string}>} */
    this._queue = [];
    this._loaded = false;
  }

  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = readFileSync(QUEUE_PATH, 'utf-8');
      this._queue = JSON.parse(raw);
    } catch {
      this._queue = [];
    }
  }

  _persist() {
    try {
      mkdirSync(dirname(QUEUE_PATH), { recursive: true });
      writeFileSync(QUEUE_PATH, JSON.stringify(this._queue, null, 2), 'utf-8');
    } catch {
      // non-blocking
    }
  }

  /**
   * Add a Firebase operation to the offline queue.
   *
   * @param {object} operation - The Firebase operation to enqueue (collection, docId, data, type)
   * @returns {string} The assigned operation ID
   */
  enqueue(operation) {
    this._ensureLoaded();
    const id = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._queue.push({ id, operation, enqueuedAt: new Date().toISOString() });
    this._persist();
    return id;
  }

  /**
   * Drain the queue by calling firebaseFn for each pending operation.
   * Removes successfully processed operations.
   *
   * @param {(operation: object) => Promise<void>} firebaseFn
   * @returns {Promise<{processed: number, failed: number}>}
   */
  async drain(firebaseFn) {
    this._ensureLoaded();
    let processed = 0;
    let failed = 0;
    const remaining = [];

    for (const item of this._queue) {
      try {
        await firebaseFn(item.operation);
        processed++;
      } catch {
        failed++;
        remaining.push(item);
      }
    }

    this._queue = remaining;
    this._persist();
    return { processed, failed };
  }

  /**
   * Returns a snapshot of the current queue (safe to serialize).
   * @returns {Array<{id: string, operation: object, enqueuedAt: string}>}
   */
  getSnapshot() {
    this._ensureLoaded();
    return [...this._queue];
  }

  /**
   * Returns the number of pending operations.
   * @returns {number}
   */
  get size() {
    this._ensureLoaded();
    return this._queue.length;
  }

  /** Clears the queue in memory and on disk. */
  clear() {
    this._queue = [];
    this._persist();
  }
}

export const offlineQueue = new OfflineQueue();
