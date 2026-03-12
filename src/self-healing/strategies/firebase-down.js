import { logger } from '../../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../../events/event-bus.js';
import { offlineQueue } from '../offline-queue.js';

/** Firebase connection error patterns */
const FIREBASE_ERROR_PATTERNS = [
  /firebase/i,
  /firestore/i,
  /UNAVAILABLE/,
  /Could not reach Cloud Firestore/i,
  /Failed to get document/i,
  /transport errored/i,
  /WebChannel transport errored/i,
  /ECONNREFUSED.*firebase/i,
  /network.*firebase/i,
  /firebase.*network/i,
  /database.*unavailable/i,
];

/** How often to check if Firebase has recovered (ms) */
const SYNC_POLL_INTERVAL_MS = 30_000;

/**
 * Self-healing strategy for Firebase outages.
 *
 * detect(): recognizes Firebase/Firestore connection errors.
 * diagnose(): identifies the type of Firebase error.
 * heal(): activates offline mode using offline-queue.js and schedules sync.
 */
export const firebaseDownStrategy = {
  name: 'firebase-down',

  /** @type {ReturnType<typeof setInterval>|null} */
  _syncInterval: null,

  /**
   * @param {{ errorMessage: string }} errorContext
   * @returns {boolean}
   */
  detect(errorContext) {
    const { errorMessage } = errorContext;
    if (!errorMessage) return false;
    return FIREBASE_ERROR_PATTERNS.some(p => p.test(errorMessage));
  },

  /**
   * @param {{ errorMessage: string }} errorContext
   * @returns {{ errorType: string, isConnectivity: boolean }}
   */
  diagnose(errorContext) {
    const { errorMessage = '' } = errorContext;
    const isConnectivity = /UNAVAILABLE|ECONNREFUSED|transport errored|Could not reach/i.test(errorMessage);
    return {
      errorType: isConnectivity ? 'connectivity' : 'firebase-error',
      isConnectivity,
    };
  },

  /**
   * Activates offline mode: enqueues the pending operation and schedules sync.
   *
   * @param {{ errorMessage: string, operation?: object, firebaseFn?: () => Promise<any> }} errorContext
   * @returns {Promise<{ healed: boolean, action: string, queueSize?: number }>}
   */
  async heal(errorContext) {
    const { operation, firebaseFn } = errorContext;

    logger.warn('Self-healing Firebase down: activating offline mode', 'SELF-HEALING');

    eventBus.emitEvent(EVENT_TYPES.SELF_HEALING_OFFLINE_MODE, {
      metadata: { queueSize: offlineQueue.size },
    });

    if (operation) {
      offlineQueue.enqueue(operation);
      logger.info(`Offline queue: ${offlineQueue.size} operations pending`, 'SELF-HEALING');
    }

    // Schedule sync if a recovery function is provided and not already scheduled
    if (typeof firebaseFn === 'function' && !this._syncInterval) {
      this.scheduleSync(firebaseFn);
    }

    return { healed: true, action: 'offline-mode', queueSize: offlineQueue.size };
  },

  /**
   * Schedules periodic attempts to drain the offline queue.
   *
   * @param {() => Promise<any>} firebaseFn - Function that executes one Firebase operation
   */
  scheduleSync(firebaseFn) {
    this._syncInterval = setInterval(async () => {
      if (offlineQueue.size === 0) {
        clearInterval(this._syncInterval);
        this._syncInterval = null;
        return;
      }

      logger.info(`Self-healing sync: attempting to drain ${offlineQueue.size} queued operations`, 'SELF-HEALING');

      try {
        const { processed, failed } = await offlineQueue.drain(firebaseFn);
        if (failed === 0) {
          clearInterval(this._syncInterval);
          this._syncInterval = null;
          eventBus.emitEvent(EVENT_TYPES.SELF_HEALING_SYNC_COMPLETED, {
            metadata: { processed },
          });
          logger.info(`Self-healing sync: drained ${processed} operations successfully`, 'SELF-HEALING');
        }
      } catch {
        // Firebase still down — will retry on next interval
      }
    }, SYNC_POLL_INTERVAL_MS);
  },
};
