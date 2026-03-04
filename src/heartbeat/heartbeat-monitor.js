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

/**
 * Periodically pings rate-limited CLIs with a trivial prompt to detect
 * when they recover from rate limits. When a CLI responds successfully,
 * it is marked as recovered in FallbackManager and a CLI_RECOVERED event
 * is emitted. If a checkpoint is active and the orchestrator is paused,
 * auto-resume is triggered.
 */
class HeartbeatMonitor {
  constructor() {
    /** @type {ReturnType<typeof setInterval>|null} */
    this._interval = null;
    /** @type {boolean} */
    this._pinging = false;
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

    if (this._interval) return;

    const intervalMs = config.heartbeatIntervalMinutes * 60 * 1000;

    logger.info(`Heartbeat monitor started (interval: ${config.heartbeatIntervalMinutes}min)`, 'HEARTBEAT');

    this._interval = setInterval(() => this._tick(), intervalMs);
  }

  /**
   * Stop the heartbeat monitor and clean up the interval.
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      logger.info('Heartbeat monitor stopped', 'HEARTBEAT');
    }
  }

  /**
   * Whether the monitor is currently running.
   * @returns {boolean}
   */
  isRunning() {
    return this._interval !== null;
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
          this._onCliRecovered(cli);
        } else {
          const reason = result.status === 'rejected' ? result.reason?.message : 'no response';
          logger.info(`CLI "${cli}" still rate-limited (${reason})`, 'HEARTBEAT');
        }
      }
    } finally {
      this._pinging = false;
    }
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
    fallbackManager.markRecovered(cli);

    logger.info(`CLI "${cli}" recovered from rate limit!`, 'HEARTBEAT');

    // Auto-resume if orchestrator is paused and there are matching checkpoints
    const autoResumeResult = await this._tryAutoResume(cli);

    const metadata = { cli };
    if (autoResumeResult) {
      metadata.autoResume = true;
      metadata.checkpoint = autoResumeResult.checkpoint;
    }

    eventBus.emitEvent(EVENT_TYPES.CLI_RECOVERED, { metadata });
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
   * @returns {Promise<{ checkpoint: string }|null>}
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

        return { checkpoint: filepath };
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
