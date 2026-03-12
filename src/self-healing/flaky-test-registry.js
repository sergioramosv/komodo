import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../../');
const REGISTRY_PATH = resolve(ROOT_DIR, '.komodo/flaky-tests.json');

/**
 * Persistent registry of known flaky tests.
 *
 * A test is considered flaky when it has failed and then passed on retry
 * without code changes. Tracks retry history to confirm flakiness.
 */
class FlakyTestRegistry {
  constructor() {
    /** @type {Record<string, {failCount: number, passCount: number, registeredAt: string, lastSeen: string}>} */
    this._registry = {};
    this._loaded = false;
  }

  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = readFileSync(REGISTRY_PATH, 'utf-8');
      this._registry = JSON.parse(raw);
    } catch {
      this._registry = {};
    }
  }

  _persist() {
    try {
      mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
      writeFileSync(REGISTRY_PATH, JSON.stringify(this._registry, null, 2), 'utf-8');
    } catch {
      // non-blocking
    }
  }

  /**
   * Register a test as potentially flaky.
   *
   * @param {string} testName
   */
  register(testName) {
    this._ensureLoaded();
    if (!this._registry[testName]) {
      this._registry[testName] = {
        failCount: 1,
        passCount: 0,
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
    } else {
      this._registry[testName].failCount++;
      this._registry[testName].lastSeen = new Date().toISOString();
    }
    this._persist();
  }

  /**
   * Check if a test is known to be flaky (has passed at least once after failing).
   *
   * @param {string} testName
   * @returns {boolean}
   */
  isKnownFlaky(testName) {
    this._ensureLoaded();
    const entry = this._registry[testName];
    return !!entry && entry.passCount > 0;
  }

  /**
   * Record the result of a retry attempt.
   *
   * @param {string} testName
   * @param {boolean} passed
   */
  recordRetryResult(testName, passed) {
    this._ensureLoaded();
    if (!this._registry[testName]) {
      this._registry[testName] = {
        failCount: 1,
        passCount: 0,
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
    }
    if (passed) {
      this._registry[testName].passCount++;
    } else {
      this._registry[testName].failCount++;
    }
    this._registry[testName].lastSeen = new Date().toISOString();
    this._persist();
  }

  /**
   * Returns all known flaky test names.
   * @returns {string[]}
   */
  getAllFlaky() {
    this._ensureLoaded();
    return Object.entries(this._registry)
      .filter(([, entry]) => entry.passCount > 0)
      .map(([name]) => name);
  }

  /**
   * Returns a snapshot of the registry.
   * @returns {Record<string, object>}
   */
  getSnapshot() {
    this._ensureLoaded();
    return { ...this._registry };
  }
}

export const flakyTestRegistry = new FlakyTestRegistry();
