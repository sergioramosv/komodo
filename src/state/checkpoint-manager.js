import { resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from './komodo-state.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

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
    /** @type {Function|null} Unsubscribe from rate limit events */
    this._unsubscribe = null;
  }

  /**
   * Start listening for rate limit events.
   */
  start() {
    if (this._unsubscribe) return;

    this._unsubscribe = eventBus.on(EVENT_TYPES.RATE_LIMIT_DETECTED, (payload) => {
      return this._onRateLimitDetected(payload);
    });
  }

  /**
   * Stop listening and clean up.
   */
  stop() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
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
}

/** Singleton instance. */
export const checkpointManager = new CheckpointManager();
