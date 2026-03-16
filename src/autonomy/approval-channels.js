import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT = 'APPROVAL';

/**
 * Singleton that orchestrates multi-channel approval requests.
 *
 * Usage:
 *   const { approved, timedOut } = await approvalChannelManager.requestApproval({ step, description, metadata });
 *
 * Any channel (Telegram, webhook, dashboard) calls:
 *   approvalChannelManager.respond(true)  // approve
 *   approvalChannelManager.respond(false) // reject
 */
class ApprovalChannelManager {
  constructor() {
    /** @type {{ resolve: Function, reject: Function, timer: NodeJS.Timeout, step: string } | null} */
    this._pending = null;

    /** Telegram message id sent for this approval (used to edit on resolution). */
    this.pendingMessageId = null;
    this.pendingChatId = null;
  }

  /**
   * Returns true if there is an active pending approval request.
   * @returns {boolean}
   */
  get hasPending() {
    return this._pending !== null;
  }

  /**
   * Returns metadata of the current pending approval, or null.
   * @returns {{ step: string, description: string, timeoutMs: number } | null}
   */
  get pendingApproval() {
    if (!this._pending) return null;
    return {
      step: this._pending.step,
      description: this._pending.description,
      timeoutMs: this._pending.timeoutMs,
    };
  }

  /**
   * Requests approval via all configured channels.
   * Returns a Promise that resolves once a channel responds or timeout fires.
   *
   * @param {Object} options
   * @param {string} options.step
   * @param {string} [options.description]
   * @param {Object} [options.metadata]
   * @returns {Promise<{ approved: boolean, timedOut: boolean }>}
   */
  requestApproval({ step, description = '', metadata = {} } = {}) {
    if (this._pending) {
      logger.warn(`[APPROVAL] Previous approval for "${this._pending.step}" still pending — overriding.`, AGENT);
      this._clear();
    }

    const timeoutMs = config.approvalTimeoutMinutes * 60 * 1000;

    return new Promise((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        const approveOnTimeout = config.approvalTimeoutAction !== 'reject';

        this._clear();

        if (approveOnTimeout) {
          eventBus.emitEvent(EVENT_TYPES.AUTONOMY_AUTO_APPROVED, {
            metadata: { step, description, reason: 'timeout', ...metadata },
          });
          logger.warn(`Timeout de aprobación para "${step}". Auto-${approveOnTimeout ? 'aprobando' : 'rechazando'}.`, AGENT);
        } else {
          eventBus.emitEvent(EVENT_TYPES.AUTONOMY_TIMED_OUT, {
            metadata: { step, description, ...metadata },
          });
          logger.warn(`Timeout de aprobación para "${step}". Rechazando.`, AGENT);
        }

        resolve({ approved: approveOnTimeout, timedOut: true });
      }, timeoutMs);

      this._pending = {
        resolve,
        timer,
        step,
        description,
        timeoutMs,
        _resolvedRef: { value: false },
        _setResolved: (v) => { resolved = v; },
        _isResolved: () => resolved,
      };

      logger.info(`[APPROVAL] Esperando respuesta para "${step}" (timeout: ${config.approvalTimeoutMinutes} min, canales: ${config.approvalChannels.join(',') || 'tty'})`, AGENT);
    });
  }

  /**
   * Alias for respond() — used by ws-server, telegram commands, and webhook handlers.
   * The requestId parameter is ignored (single-slot model); use respond() directly.
   *
   * @param {string} _requestId - Ignored in single-slot model
   * @param {boolean} approved
   * @returns {boolean}
   */
  resolveApproval(_requestId, approved) {
    return this.respond(approved);
  }

  /**
   * Responds to the current pending approval request.
   * Safe to call from any channel (Telegram, webhook, dashboard).
   * Ignores duplicate calls.
   *
   * @param {boolean} approved - true to approve, false to reject
   * @returns {boolean} Whether there was a pending approval to respond to
   */
  respond(approved) {
    if (!this._pending) {
      logger.warn('[APPROVAL] respond() called but no pending approval.', AGENT);
      return false;
    }

    if (this._pending._isResolved()) {
      logger.warn('[APPROVAL] respond() called but approval already resolved (duplicate — ignoring).', AGENT);
      return false;
    }

    this._pending._setResolved(true);
    const { resolve, timer, step, description } = this._pending;
    clearTimeout(timer);
    this._clear();

    if (approved) {
      eventBus.emitEvent(EVENT_TYPES.AUTONOMY_APPROVED, {
        metadata: { step, description },
      });
      logger.info(`Aprobado para "${step}".`, AGENT);
    } else {
      eventBus.emitEvent(EVENT_TYPES.AUTONOMY_REJECTED, {
        metadata: { step, description },
      });
      logger.warn(`Rechazado para "${step}".`, AGENT);
    }

    resolve({ approved, timedOut: false });
    return true;
  }

  /** Clears internal pending state (does NOT resolve the promise). */
  _clear() {
    if (this._pending?.timer) clearTimeout(this._pending.timer);
    this._pending = null;
    this.pendingMessageId = null;
    this.pendingChatId = null;
  }
}

export const approvalChannelManager = new ApprovalChannelManager();

/** Exported constant listing the configured channels (from config). */
export const APPROVAL_CHANNELS = config.approvalChannels;
