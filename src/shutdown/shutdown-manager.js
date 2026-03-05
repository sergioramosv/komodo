import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { checkpointManager } from '../state/checkpoint-manager.js';

/**
 * Default timeout (ms) to wait for the active agent to finish before force-killing.
 */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Manages graceful shutdown of Komodo on SIGINT/SIGTERM.
 *
 * Responsibilities:
 * 1. Register process signal handlers (SIGINT, SIGTERM)
 * 2. Wait for active agent up to a timeout, then force stop
 * 3. Save a checkpoint of the current task
 * 4. Close WebSocket server cleanly
 * 5. Prevent orphaned PRs by persisting state for resume
 */
class ShutdownManager {
  constructor() {
    /** @type {import('../server/ws-server.js').KomodoWsServer|null} */
    this._wsServer = null;

    /** @type {boolean} */
    this._shuttingDown = false;

    /** @type {number} */
    this._timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS;

    /** @type {Function[]} Bound signal handlers for cleanup */
    this._handlers = {};

    /** @type {boolean} */
    this._registered = false;
  }

  /**
   * Register SIGINT/SIGTERM handlers and bind the WS server for cleanup.
   *
   * @param {Object} options
   * @param {import('../server/ws-server.js').KomodoWsServer} [options.wsServer] - WS server to close on shutdown
   * @param {number} [options.timeoutMs=30000] - Max time to wait for agent before force stop
   */
  register(options = {}) {
    if (this._registered) return;

    this._wsServer = options.wsServer || null;
    this._timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

    this._handlers.sigint = () => this._onSignal('SIGINT');
    this._handlers.sigterm = () => this._onSignal('SIGTERM');

    process.on('SIGINT', this._handlers.sigint);
    process.on('SIGTERM', this._handlers.sigterm);

    this._registered = true;
  }

  /**
   * Unregister signal handlers (for cleanup in tests or after shutdown completes).
   */
  unregister() {
    if (!this._registered) return;

    if (this._handlers.sigint) {
      process.removeListener('SIGINT', this._handlers.sigint);
    }
    if (this._handlers.sigterm) {
      process.removeListener('SIGTERM', this._handlers.sigterm);
    }

    this._handlers = {};
    this._wsServer = null;
    this._shuttingDown = false;
    this._registered = false;
  }

  /**
   * Handle a process signal (SIGINT or SIGTERM).
   *
   * @param {string} signal - The signal name
   * @private
   */
  async _onSignal(signal) {
    // Prevent double shutdown (e.g. user presses Ctrl+C twice)
    if (this._shuttingDown) {
      logger.warn('Forced shutdown (second signal). Exiting immediately.', 'SHUTDOWN');
      process.exit(1);
    }

    this._shuttingDown = true;
    logger.info(`${signal} received. Starting graceful shutdown...`, 'SHUTDOWN');

    eventBus.emitEvent(EVENT_TYPES.SHUTDOWN_STARTED, {
      metadata: { signal, timeoutMs: this._timeoutMs },
    });

    try {
      await this._performShutdown();
    } catch (err) {
      logger.error(`Error during shutdown: ${err.message}`, 'SHUTDOWN');
    }

    eventBus.emitEvent(EVENT_TYPES.SHUTDOWN_COMPLETE, {
      metadata: { signal },
    });

    this.unregister();

    logger.info('Graceful shutdown complete.', 'SHUTDOWN');
    process.exit(0);
  }

  /**
   * Execute the shutdown sequence:
   * 1. Signal orchestrator to stop (triggers stop check in main loop)
   * 2. Wait for active agent to finish (up to timeout)
   * 3. Save checkpoint if a task is in progress
   * 4. Close WebSocket connections
   * 5. Stop checkpoint manager
   *
   * @private
   */
  async _performShutdown() {
    // 1. Signal the orchestrator to stop
    komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
    logger.info('Stop signal sent to orchestrator.', 'SHUTDOWN');

    // 2. Wait for active agent to finish (if running)
    const isActive = komodoState.phase !== 'idle';
    if (isActive) {
      logger.info(`Waiting up to ${this._timeoutMs / 1000}s for active agent to finish...`, 'SHUTDOWN');

      const finished = await this._waitForIdle(this._timeoutMs);

      if (!finished) {
        logger.warn(`Timeout reached. Agent did not finish within ${this._timeoutMs / 1000}s.`, 'SHUTDOWN');
      } else {
        logger.info('Active agent finished.', 'SHUTDOWN');
      }
    }

    // 3. Save checkpoint if there's a task in progress
    const snapshot = komodoState.getSnapshot();
    if (snapshot.currentTask) {
      await this._saveShutdownCheckpoint(snapshot);
    }

    // 4. Close WebSocket server
    if (this._wsServer) {
      logger.info('Closing WebSocket connections...', 'SHUTDOWN');
      await this._wsServer.stop();
      this._wsServer = null;
    }

    // 5. Stop checkpoint manager
    checkpointManager.stop();
  }

  /**
   * Wait until komodoState.phase becomes 'idle' or timeout expires.
   *
   * @param {number} timeoutMs - Max time to wait
   * @returns {Promise<boolean>} true if idle was reached, false if timed out
   * @private
   */
  _waitForIdle(timeoutMs) {
    return new Promise((resolve) => {
      if (komodoState.phase === 'idle') {
        resolve(true);
        return;
      }

      const checkInterval = 500;
      let elapsed = 0;

      const timer = setInterval(() => {
        elapsed += checkInterval;
        if (komodoState.phase === 'idle' || elapsed >= timeoutMs) {
          clearInterval(timer);
          resolve(komodoState.phase === 'idle');
        }
      }, checkInterval);
    });
  }

  /**
   * Save a shutdown checkpoint so the task can be resumed later.
   *
   * @param {Object} snapshot - Current komodoState snapshot
   * @private
   */
  async _saveShutdownCheckpoint(snapshot) {
    try {
      logger.info(`Saving checkpoint for task "${snapshot.currentTask}"...`, 'SHUTDOWN');

      // Use the checkpoint manager's internal save via a synthetic rate limit event
      // to reuse existing persistence logic
      const { resolve } = await import('path');
      const { mkdir, writeFile } = await import('fs/promises');
      const { config } = await import('../config.js');

      const PHASE_TO_FLOW_STEP = {
        planning: 'plan',
        coding: 'code',
        analyzing: 'analyze',
        reviewing: 'review',
        merging: 'merge',
      };

      const flowContext = checkpointManager._flowContext || {};
      const flowStep = flowContext.flowStep || PHASE_TO_FLOW_STEP[snapshot.phase] || snapshot.phase;

      const checkpoint = {
        taskId: snapshot.currentTask,
        taskTitle: snapshot.taskDetails?.title || null,
        flowStep,
        branchName: flowContext.branchName || null,
        prNumber: snapshot.currentPR || null,
        repoUrl: flowContext.repoUrl || null,
        agentRole: null,
        cliType: null,
        timestamp: new Date().toISOString(),
        reviewRound: snapshot.reviewCycle || null,
        reviewIssues: flowContext.reviewIssues || null,
        reason: 'graceful-shutdown',
      };

      const safeTaskId = (checkpoint.taskId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `checkpoint-${safeTaskId}-${Date.now()}.json`;
      const checkpointDir = resolve(config.rootDir, '.komodo', 'checkpoints');
      const filepath = resolve(checkpointDir, filename);

      await mkdir(checkpointDir, { recursive: true });
      await writeFile(filepath, JSON.stringify(checkpoint, null, 2), 'utf-8');

      eventBus.emitEvent(EVENT_TYPES.SESSION_CHECKPOINTED, {
        metadata: { path: filepath, reason: 'graceful-shutdown' },
      });

      logger.success(`Checkpoint saved: ${filepath}`, 'SHUTDOWN');
    } catch (err) {
      logger.error(`Failed to save shutdown checkpoint: ${err.message}`, 'SHUTDOWN');
    }
  }

  /**
   * @returns {boolean} True if shutdown is in progress.
   */
  get isShuttingDown() {
    return this._shuttingDown;
  }
}

/** Singleton instance. */
export const shutdownManager = new ShutdownManager();

// Export class for testing
export { ShutdownManager, DEFAULT_SHUTDOWN_TIMEOUT_MS };
