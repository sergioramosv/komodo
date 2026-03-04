import { spawn } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { fallbackManager } from '../agents/fallback-manager.js';
import { checkpointManager } from '../state/checkpoint-manager.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { resumeTask } from '../cycle/task-runner.js';

const PING_TIMEOUT_MS = 10_000;
const PING_PROMPT = 'Respond with exactly: OK';

/** Backoff constants */
const BACKOFF_BASE_MINUTES = 5;
const BACKOFF_MAX_MINUTES = 60;
const BACKOFF_MULTIPLIER = 2;

/** Margin added to retry-after delays (seconds). */
const RETRY_AFTER_MARGIN_S = 10;

/**
 * Periodically pings rate-limited CLIs with a trivial prompt to detect
 * when they recover from rate limits. When a CLI responds successfully,
 * it is marked as recovered in FallbackManager and a CLI_RECOVERED event
 * is emitted. If a checkpoint is active and the orchestrator is paused,
 * auto-resume is triggered.
 *
 * Supports smart scheduling:
 * - If a retry-after header/message is detected, the next heartbeat for
 *   that CLI is scheduled at the specified time + margin.
 * - If no retry-after is available, exponential backoff is used
 *   (5 → 10 → 20 → 40 → 60 min max).
 * - On recovery, the interval resets to the base value.
 */
class HeartbeatMonitor {
  constructor() {
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._timeout = null;
    /** @type {boolean} */
    this._pinging = false;
    /** @type {boolean} */
    this._running = false;

    /**
     * Per-CLI backoff state.
     * @type {Map<string, { consecutiveFails: number, retryAfterSeconds: number|null }>}
     */
    this._cliBackoff = new Map();

    /** @type {(() => void)|null} Event listener unsubscribe function */
    this._rateLimitUnsub = null;
  }

  /**
   * Start the periodic heartbeat check.
   * No-op if heartbeat is disabled or already running.
   */
  start() {
    if (!config.heartbeatEnabled) {
      logger.info('Heartbeat monitor disabled (HEARTBEAT_ENABLED=false)', 'HEARTBEAT');
      return;
    }

    if (this._running) return;
    this._running = true;

    logger.info(`Heartbeat monitor started (base interval: ${BACKOFF_BASE_MINUTES}min)`, 'HEARTBEAT');

    // Listen for rate limit events to capture retry-after info
    this._rateLimitUnsub = this._listenForRetryAfter();

    this._scheduleNextTick();
  }

  /**
   * Stop the heartbeat monitor and clean up timers and listeners.
   */
  stop() {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }

    if (this._rateLimitUnsub) {
      this._rateLimitUnsub();
      this._rateLimitUnsub = null;
    }

    if (this._running) {
      this._running = false;
      this._cliBackoff.clear();
      logger.info('Heartbeat monitor stopped', 'HEARTBEAT');
    }
  }

  /**
   * Whether the monitor is currently running.
   * @returns {boolean}
   */
  isRunning() {
    return this._running;
  }

  /**
   * Get the current backoff state for a CLI (for testing/debugging).
   *
   * @param {string} cli - CLI identifier
   * @returns {{ consecutiveFails: number, retryAfterSeconds: number|null }|undefined}
   */
  getBackoffState(cli) {
    return this._cliBackoff.get(cli);
  }

  /**
   * Listen for RATE_LIMIT_DETECTED events to capture retry-after per CLI.
   *
   * @returns {() => void} Unsubscribe function
   * @private
   */
  _listenForRetryAfter() {
    const handler = (payload) => {
      const { cli, retryAfterSeconds } = payload.metadata || {};
      if (!cli) return;

      const state = this._cliBackoff.get(cli) || { consecutiveFails: 0, retryAfterSeconds: null };
      state.retryAfterSeconds = retryAfterSeconds || null;
      this._cliBackoff.set(cli, state);

      if (retryAfterSeconds) {
        logger.info(
          `Rate limit says retry after ${retryAfterSeconds}s. Next heartbeat in ${((retryAfterSeconds + RETRY_AFTER_MARGIN_S) / 60).toFixed(1)} min`,
          'HEARTBEAT',
        );
      }
    };

    eventBus.on(EVENT_TYPES.RATE_LIMIT_DETECTED, handler);
    return () => eventBus.removeListener(EVENT_TYPES.RATE_LIMIT_DETECTED, handler);
  }

  /**
   * Calculate the next tick delay in milliseconds.
   *
   * Strategy:
   * 1. If any CLI has a retry-after value, use that + margin
   * 2. Otherwise, use exponential backoff based on max consecutive fails
   * 3. On first start (no fails), use the base interval
   *
   * @returns {number} Delay in milliseconds
   * @private
   */
  _getNextTickDelay() {
    const rateLimitedClis = fallbackManager.getRateLimitedClis();

    // If no CLIs are rate-limited, use base interval
    if (rateLimitedClis.length === 0) {
      return BACKOFF_BASE_MINUTES * 60 * 1000;
    }

    let minDelayMs = Infinity;

    for (const cli of rateLimitedClis) {
      const state = this._cliBackoff.get(cli);

      if (state?.retryAfterSeconds) {
        // Use retry-after + margin
        const delayMs = (state.retryAfterSeconds + RETRY_AFTER_MARGIN_S) * 1000;
        minDelayMs = Math.min(minDelayMs, delayMs);
      } else {
        // Exponential backoff: base * 2^fails, capped at max
        const fails = state?.consecutiveFails || 0;
        const backoffMinutes = Math.min(
          BACKOFF_BASE_MINUTES * Math.pow(BACKOFF_MULTIPLIER, fails),
          BACKOFF_MAX_MINUTES,
        );
        const delayMs = backoffMinutes * 60 * 1000;
        minDelayMs = Math.min(minDelayMs, delayMs);
      }
    }

    return minDelayMs === Infinity ? BACKOFF_BASE_MINUTES * 60 * 1000 : minDelayMs;
  }

  /**
   * Schedule the next heartbeat tick using setTimeout for dynamic intervals.
   * @private
   */
  _scheduleNextTick() {
    if (!this._running) return;

    const delayMs = this._getNextTickDelay();
    const delayMinutes = (delayMs / 60_000).toFixed(1);

    logger.info(`Next heartbeat in ${delayMinutes} min`, 'HEARTBEAT');

    this._timeout = setTimeout(async () => {
      await this._tick();
      this._scheduleNextTick();
    }, delayMs);
  }

  /**
   * Single heartbeat tick: ping all rate-limited CLIs.
   * @private
   */
  async _tick() {
    if (this._pinging) return; // Skip if previous tick still running

    const rateLimitedClis = fallbackManager.getRateLimitedClis();
    if (rateLimitedClis.length === 0) return;

    this._pinging = true;
    logger.info(`Pinging ${rateLimitedClis.length} rate-limited CLI(s): ${rateLimitedClis.join(', ')}`, 'HEARTBEAT');

    try {
      const results = await Promise.allSettled(
        rateLimitedClis.map(cli => this._pingCli(cli)),
      );

      for (let i = 0; i < rateLimitedClis.length; i++) {
        const cli = rateLimitedClis[i];
        const result = results[i];

        if (result.status === 'fulfilled' && result.value) {
          this._resetBackoff(cli);
          await this._onCliRecovered(cli);
        } else {
          this._incrementBackoff(cli);
          const reason = result.status === 'rejected' ? result.reason?.message : 'no response';
          const state = this._cliBackoff.get(cli);
          const fails = state?.consecutiveFails || 0;
          logger.info(`CLI "${cli}" still rate-limited (${reason}) [attempt ${fails}]`, 'HEARTBEAT');
        }
      }
    } finally {
      this._pinging = false;
    }
  }

  /**
   * Increment backoff counter for a CLI after a failed ping.
   * Clears retry-after since the delay has already passed.
   *
   * @param {string} cli - CLI identifier
   * @private
   */
  _incrementBackoff(cli) {
    const state = this._cliBackoff.get(cli) || { consecutiveFails: 0, retryAfterSeconds: null };
    state.consecutiveFails++;
    state.retryAfterSeconds = null; // Clear: the retry-after window has passed
    this._cliBackoff.set(cli, state);
  }

  /**
   * Reset backoff state for a CLI after recovery.
   *
   * @param {string} cli - CLI identifier
   * @private
   */
  _resetBackoff(cli) {
    this._cliBackoff.delete(cli);
  }

  /**
   * Ping a single CLI with a trivial prompt and short timeout.
   *
   * @param {string} cli - CLI identifier (claude, codex, gemini)
   * @returns {Promise<boolean>} True if the CLI responded successfully
   * @private
   */
  _pingCli(cli) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timeout = setTimeout(() => {
        settle(false);
        try { proc.kill(); } catch { /* already dead */ }
      }, PING_TIMEOUT_MS);

      const args = this._buildPingArgs(cli);
      const proc = spawn(cli, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        shell: process.platform === 'win32',
      });

      proc.stdin.write(PING_PROMPT);
      proc.stdin.end();

      let stdout = '';
      proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        // Any non-error exit with some output = CLI is alive
        settle(code === 0 && stdout.length > 0);
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        settle(false);
      });
    });
  }

  /**
   * Build minimal CLI arguments for a heartbeat ping.
   *
   * @param {string} cli - CLI identifier
   * @returns {string[]}
   * @private
   */
  _buildPingArgs(cli) {
    switch (cli) {
    case 'claude':
      return ['--output-format', 'json', '--max-turns', '1'];
    case 'codex':
      return ['exec', '--json', '--full-auto', '-'];
    case 'gemini':
      return ['--output-format', 'json', '--yolo'];
    default:
      return [];
    }
  }

  /**
   * Handle a CLI that responded successfully to the heartbeat ping.
   *
   * @param {string} cli - CLI identifier that recovered
   * @private
   */
  async _onCliRecovered(cli) {
    // Calculate downtime before clearing the rate-limit record
    const downtimeMinutes = this._getDowntimeMinutes(cli);

    fallbackManager.markRecovered(cli);

    logger.info(`CLI "${cli}" recovered from rate limit!`, 'HEARTBEAT');

    // Auto-resume if orchestrator is paused and there are matching checkpoints
    const autoResumeResult = await this._tryAutoResume(cli);

    // Build metadata with context for notifications
    const snapshot = komodoState.getSnapshot();

    const metadata = { cli, downtimeMinutes };
    if (autoResumeResult) {
      metadata.autoResume = true;
      metadata.checkpoint = autoResumeResult.checkpoint;
      if (autoResumeResult.taskTitle) metadata.taskTitle = autoResumeResult.taskTitle;
    } else if (snapshot.currentTask) {
      metadata.taskTitle = snapshot.currentTask;
    }

    eventBus.emitEvent(EVENT_TYPES.CLI_RECOVERED, { metadata });
  }

  /**
   * Calculate downtime in minutes for a CLI based on when it was rate-limited.
   *
   * @param {string} cli - CLI identifier
   * @returns {number} Downtime in minutes (0 if unknown)
   * @private
   */
  _getDowntimeMinutes(cli) {
    const rateLimitedAt = fallbackManager.getRateLimitedTimestamp?.(cli);
    if (!rateLimitedAt) return 0;
    return Math.round((Date.now() - rateLimitedAt) / 60_000);
  }

  /**
   * Attempt auto-resume if conditions are met:
   * - Orchestrator is in PAUSED state
   * - There are pending checkpoints whose CLI matches the recovered one
   *
   * If resume succeeds, deletes the checkpoint and emits SESSION_AUTO_RESUMED.
   * If resume fails, leaves the checkpoint for retry on the next tick.
   *
   * @param {string} cli - The CLI that just recovered
   * @returns {Promise<{ checkpoint: string, taskTitle: string }|null>}
   * @private
   */
  async _tryAutoResume(cli) {
    try {
      const snapshot = komodoState.getSnapshot();
      if (snapshot.executionState !== EXECUTION_STATES.PAUSED) return null;

      // List checkpoints sorted newest-first
      const pending = await checkpointManager.listPendingCheckpoints();
      if (pending.length === 0) return null;

      // Find the most recent checkpoint whose CLI matches the recovered one
      const match = pending.find(({ checkpoint }) => checkpoint.cliType === cli);
      if (!match) {
        // No checkpoint for this CLI — still resume if any checkpoint exists
        // (the recovered CLI might be needed for the next step)
        return null;
      }

      const { filepath, checkpoint } = match;

      // Validate checkpoint before resuming
      const validation = checkpointManager.validateCheckpoint(checkpoint);
      if (!validation.valid) {
        logger.warn(`Checkpoint invalid (${validation.reason}), discarding: ${filepath}`, 'HEARTBEAT');
        await checkpointManager.deleteCheckpoint(filepath);
        return null;
      }

      const downtimeMs = Date.now() - new Date(checkpoint.timestamp).getTime();
      const downtimeMinutes = Math.round(downtimeMs / 60_000);

      logger.info(
        `CLI "${cli}" recovered + matching checkpoint found → auto-resuming task "${checkpoint.taskTitle}" from step "${checkpoint.flowStep}" (downtime: ${downtimeMinutes}min)`,
        'HEARTBEAT',
      );

      komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

      // Start checkpoint manager for potential new rate limits during resume
      checkpointManager.start();

      const result = await resumeTask(checkpoint, config.rootDir);

      if (result.success) {
        // Delete the resumed checkpoint
        await checkpointManager.deleteCheckpoint(filepath);
        logger.info(`Checkpoint deleted after successful auto-resume: ${filepath}`, 'HEARTBEAT');

        // Clean up remaining checkpoints for the same task
        const remaining = await checkpointManager.listPendingCheckpoints();
        for (const { filepath: fp, checkpoint: cp } of remaining) {
          if (cp.taskId === checkpoint.taskId) {
            await checkpointManager.deleteCheckpoint(fp);
          }
        }

        eventBus.emitEvent(EVENT_TYPES.SESSION_AUTO_RESUMED, {
          metadata: {
            taskId: checkpoint.taskId,
            cli,
            downtimeMinutes,
          },
        });

        logger.info(
          `Auto-resume successful: task "${checkpoint.taskTitle}" completed from step "${checkpoint.flowStep}"`,
          'HEARTBEAT',
        );

        return { checkpoint: filepath, taskTitle: checkpoint.taskTitle };
      }

      // Resume failed — leave checkpoint for retry on next tick
      logger.warn(
        `Auto-resume failed for task "${checkpoint.taskTitle}": ${result.error || 'unknown error'}. Will retry on next heartbeat tick.`,
        'HEARTBEAT',
      );

      // Set back to PAUSED so next tick can try again
      komodoState.setExecutionState(EXECUTION_STATES.PAUSED);

      return null;
    } catch (err) {
      logger.error(`Auto-resume check failed: ${err.message}`, 'HEARTBEAT');
      // Ensure state is PAUSED for retry
      try {
        komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
      } catch { /* best effort */ }
      return null;
    }
  }
}

/** Singleton instance. */
export const heartbeatMonitor = new HeartbeatMonitor();
