import { spawn } from 'child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { fallbackManager } from '../agents/fallback-manager.js';
import { checkpointManager } from '../state/checkpoint-manager.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';

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

    // Auto-resume if orchestrator is paused and there are pending checkpoints
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
   * - There are pending checkpoints
   *
   * @param {string} cli - The CLI that just recovered
   * @private
   */
  async _tryAutoResume(cli) {
    try {
      const snapshot = komodoState.getSnapshot();
      if (snapshot.executionState !== EXECUTION_STATES.PAUSED) return null;

      const pending = await checkpointManager.listPendingCheckpoints();
      if (pending.length === 0) return null;

      logger.info(
        `CLI "${cli}" recovered + checkpoint active → triggering auto-resume`,
        'HEARTBEAT',
      );

      komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

      return { checkpoint: pending[0].filepath };
    } catch (err) {
      logger.error(`Auto-resume check failed: ${err.message}`, 'HEARTBEAT');
      return null;
    }
  }
}

/** Singleton instance. */
export const heartbeatMonitor = new HeartbeatMonitor();
