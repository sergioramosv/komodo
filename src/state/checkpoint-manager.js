import { resolve } from 'path';
import { mkdir, writeFile, readdir, readFile, unlink } from 'fs/promises';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from './komodo-state.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { fallbackManager } from '../agents/fallback-manager.js';

/**
 * Maps orchestrator phases to flow step names used in checkpoints.
 */
const PHASE_TO_FLOW_STEP = {
  planning: 'plan',
  coding: 'code',
  analyzing: 'analyze',
  reviewing: 'review',
  merging: 'merge',
};

/**
 * Manages checkpoint persistence for rate limit recovery.
 *
 * When a rate limit is detected, this module:
 * 1. Serializes the current session state to a JSON file
 * 2. Emits a SESSION_CHECKPOINTED event
 * 3. Pauses the orchestrator cleanly (lets current agent finish)
 */
class CheckpointManager {
  constructor() {
    /** @type {Object} Extra flow context set by task-runner / review-loop */
    this._flowContext = {};
    /** @type {Function|null} Bound handler for rate limit events */
    this._rateLimitHandler = null;
  }

  /**
   * Start listening for rate limit events.
   */
  start() {
    if (this._rateLimitHandler) return;

    this._rateLimitHandler = (payload) => {
      return this._onRateLimitDetected(payload);
    };
    const maybeUnsubscribe = eventBus.on(EVENT_TYPES.RATE_LIMIT_DETECTED, this._rateLimitHandler);
    // Support both EventEmitter (returns this) and unsubscribe-pattern (returns function)
    this._unsubscribeFn = typeof maybeUnsubscribe === 'function'
      ? maybeUnsubscribe
      : () => eventBus.off(EVENT_TYPES.RATE_LIMIT_DETECTED, this._rateLimitHandler);
  }

  /**
   * Stop listening and clean up.
   */
  stop() {
    if (this._rateLimitHandler) {
      this._unsubscribeFn?.();
      this._rateLimitHandler = null;
      this._unsubscribeFn = null;
    }
    this._flowContext = {};
  }

  /**
   * Set additional flow context for the checkpoint.
   *
   * Called by task-runner and review-loop at each step transition
   * to track data not available in komodoState (branch, repo, review issues, etc.)
   *
   * @param {Object} context
   * @param {string} [context.branchName]
   * @param {string} [context.repoUrl]
   * @param {string} [context.flowStep] - Override: 'fix' when Coder is fixing review issues
   * @param {Array}  [context.reviewIssues] - Current review issues (during fix step)
   */
  setFlowContext(context) {
    Object.assign(this._flowContext, context);
  }

  /**
   * Clear flow context (between tasks).
   */
  clearFlowContext() {
    this._flowContext = {};
  }

  /**
   * Handle a rate limit detection event.
   *
   * @param {Object} payload - Event payload from RATE_LIMIT_DETECTED
   * @private
   */
  async _onRateLimitDetected(payload) {
    try {
      const cli = payload.metadata?.cli;

      // If fallback is enabled and an alternative CLI is available,
      // skip checkpoint/pause — the next agent call will use the fallback CLI.
      if (fallbackManager.isEnabled() && cli) {
        const fallbackCli = fallbackManager.getAvailableFallbackCli(cli);
        if (fallbackCli) {
          logger.info(
            `Rate limit on "${cli}" — fallback available ("${fallbackCli}"). Skipping checkpoint.`,
            'KOMODO',
          );
          return;
        }
      }

      // No fallback available (or disabled) — checkpoint and pause
      const checkpointPath = await this._saveCheckpoint(payload);

      eventBus.emitEvent(EVENT_TYPES.SESSION_CHECKPOINTED, {
        metadata: { path: checkpointPath },
      });

      // Pause the orchestrator cleanly — the current agent process will
      // finish its output naturally, then the task-runner will notice the
      // paused state and return without starting the next step.
      komodoState.setExecutionState(EXECUTION_STATES.PAUSED);

      logger.warn(`Rate limit detected. Checkpoint saved: ${checkpointPath}`, 'KOMODO');
      logger.warn('Execution paused. Current agent will finish, then orchestrator will stop.', 'KOMODO');
    } catch (err) {
      logger.error(`Failed to save checkpoint: ${err.message}`, 'KOMODO');
    }
  }

  /**
   * Serialize and persist the current session state.
   *
   * @param {Object} payload - Rate limit event payload
   * @returns {Promise<string>} Path to the saved checkpoint file
   * @private
   */
  async _saveCheckpoint(payload) {
    const snapshot = komodoState.getSnapshot();
    const phase = snapshot.phase;
    const flowStep = this._flowContext.flowStep || PHASE_TO_FLOW_STEP[phase] || phase;

    const checkpoint = {
      taskId: snapshot.currentTask,
      taskTitle: snapshot.taskDetails?.title || null,
      flowStep,
      branchName: this._flowContext.branchName || null,
      prNumber: snapshot.currentPR,
      repoUrl: this._flowContext.repoUrl || null,
      agentRole: payload.agentName,
      cliType: payload.metadata?.cli || null,
      timestamp: new Date().toISOString(),
      reviewRound: snapshot.reviewCycle || null,
      reviewIssues: this._flowContext.reviewIssues || null,
    };

    const safeTaskId = (checkpoint.taskId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `checkpoint-${safeTaskId}-${Date.now()}.json`;
    const checkpointDir = resolve(config.rootDir, '.komodo', 'checkpoints');
    const filepath = resolve(checkpointDir, filename);

    await mkdir(checkpointDir, { recursive: true });
    await writeFile(filepath, JSON.stringify(checkpoint, null, 2), 'utf-8');

    return filepath;
  }

  // ═══════════════════════════════════════════
  // Resume support
  // ═══════════════════════════════════════════

  /**
   * List all pending checkpoint files, sorted by timestamp (newest first).
   *
   * @returns {Promise<Array<{ filepath: string, checkpoint: Object }>>}
   */
  async listPendingCheckpoints() {
    const checkpointDir = resolve(config.rootDir, '.komodo', 'checkpoints');

    let files;
    try {
      files = await readdir(checkpointDir);
    } catch {
      return []; // Directory doesn't exist → no checkpoints
    }

    const jsonFiles = files.filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'));
    if (jsonFiles.length === 0) return [];

    const results = [];
    for (const file of jsonFiles) {
      const filepath = resolve(checkpointDir, file);
      try {
        const raw = await readFile(filepath, 'utf-8');
        const checkpoint = JSON.parse(raw);
        results.push({ filepath, checkpoint });
      } catch {
        logger.warn(`Checkpoint corrupto, descartando: ${file}`, 'KOMODO');
        await this.deleteCheckpoint(resolve(checkpointDir, file));
      }
    }

    // Sort newest first by timestamp
    results.sort((a, b) => new Date(b.checkpoint.timestamp) - new Date(a.checkpoint.timestamp));
    return results;
  }

  /**
   * Load and parse a single checkpoint file.
   *
   * @param {string} filepath - Absolute path to checkpoint JSON
   * @returns {Promise<Object|null>} Parsed checkpoint or null if corrupted
   */
  async loadCheckpoint(filepath) {
    try {
      const raw = await readFile(filepath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      logger.error(`Failed to load checkpoint: ${err.message}`, 'KOMODO');
      return null;
    }
  }

  /**
   * Validate that a checkpoint's external resources (branch, PR) still exist.
   *
   * @param {Object} checkpoint - Parsed checkpoint data
   * @returns {{ valid: boolean, reason?: string }}
   */
  validateCheckpoint(checkpoint) {
    if (!checkpoint || !checkpoint.taskId) {
      return { valid: false, reason: 'Checkpoint sin taskId' };
    }
    if (!checkpoint.flowStep) {
      return { valid: false, reason: 'Checkpoint sin flowStep' };
    }
    // Steps that require a PR must have a prNumber
    const prSteps = ['analyze', 'review', 'fix', 'merge'];
    if (prSteps.includes(checkpoint.flowStep) && !checkpoint.prNumber) {
      return { valid: false, reason: `Paso "${checkpoint.flowStep}" requiere prNumber pero no existe` };
    }
    // Steps that require a branch must have branchName
    const branchSteps = ['code', 'analyze', 'review', 'fix', 'merge'];
    if (branchSteps.includes(checkpoint.flowStep) && !checkpoint.branchName) {
      return { valid: false, reason: `Paso "${checkpoint.flowStep}" requiere branchName pero no existe` };
    }
    return { valid: true };
  }

  /**
   * Delete a checkpoint file after successful resume or when corrupted.
   *
   * @param {string} filepath - Absolute path to checkpoint file
   */
  async deleteCheckpoint(filepath) {
    try {
      await unlink(filepath);
    } catch {
      // File might already be deleted, that's OK
    }
  }
}

/** Singleton instance. */
export const checkpointManager = new CheckpointManager();
