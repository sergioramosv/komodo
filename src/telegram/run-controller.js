import { run } from '../orchestrator.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { getBot } from './bot.js';
import {
  formatRunStarted,
  formatRunSummary,
  formatDryRunResult,
  formatStopConfirmed,
  formatAlreadyRunning,
  formatNothingRunning,
} from './formatter.js';

const AGENT = 'TELEGRAM';

/** Promise of the currently active execution, or null. */
let activeRun = null;

/**
 * Returns true if an execution is currently in progress.
 * @returns {boolean}
 */
export function isRunning() {
  return activeRun !== null;
}

/**
 * Starts task execution from Telegram.
 * Runs asynchronously — sends immediate feedback and a summary when done.
 *
 * @param {number|string} chatId - Telegram chat ID to send messages to
 * @param {Object} [options]
 * @param {number} [options.tasks=1] - Number of tasks (0 = all)
 * @returns {boolean} true if execution started, false if already running
 */
export function startExecution(chatId, options = {}) {
  const { tasks = 1 } = options;

  // Prevent concurrent executions
  if (isRunning()) {
    sendMessage(chatId, formatAlreadyRunning());
    return false;
  }

  const projectId = config.defaultProjectId;
  if (!projectId) {
    sendMessage(chatId, 'Error: DEFAULT\\_PROJECT\\_ID no configurado\\.');
    return false;
  }

  // Send immediate feedback
  sendMessage(chatId, formatRunStarted({ tasks }));

  // Start execution in background
  activeRun = run(projectId, { tasks })
    .then((result) => {
      sendMessage(chatId, formatRunSummary(result));
    })
    .catch((err) => {
      logger.error(`Telegram run error: ${err.message}`, AGENT);
      sendMessage(chatId, `Error de ejecuci\u00f3n: ${escapeForPlain(err.message)}`);
    })
    .finally(() => {
      activeRun = null;
    });

  return true;
}

/**
 * Runs a dry-run: shows which task would be selected without executing.
 *
 * @param {number|string} chatId - Telegram chat ID
 */
export async function runDryRun(chatId) {
  if (isRunning()) {
    sendMessage(chatId, formatAlreadyRunning());
    return;
  }

  const projectId = config.defaultProjectId;
  if (!projectId) {
    sendMessage(chatId, 'Error: DEFAULT\\_PROJECT\\_ID no configurado\\.');
    return;
  }

  sendMessage(chatId, '\u{1F50D} Ejecutando dry\\-run\\.\\.\\.');

  try {
    const result = await run(projectId, { dryRun: true });
    sendMessage(chatId, formatDryRunResult(result));
  } catch (err) {
    logger.error(`Telegram dry-run error: ${err.message}`, AGENT);
    sendMessage(chatId, `Error en dry\\-run: ${escapeForPlain(err.message)}`);
  }
}

/**
 * Signals the orchestrator to stop after the current task.
 *
 * @param {number|string} chatId - Telegram chat ID
 */
export function stopExecution(chatId) {
  if (!isRunning()) {
    sendMessage(chatId, formatNothingRunning());
    return;
  }

  komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
  sendMessage(chatId, formatStopConfirmed());
}

/**
 * Sends a MarkdownV2 message to a chat.
 * @param {number|string} chatId
 * @param {string} text - MarkdownV2 formatted text
 */
function sendMessage(chatId, text) {
  const bot = getBot();
  if (!bot) return;

  bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' }).catch(err => {
    logger.error(`sendMessage error: ${err.message}`, AGENT);
  });
}

/**
 * Minimal escape for plain error messages in MarkdownV2.
 * @param {string} text
 * @returns {string}
 */
function escapeForPlain(text) {
  if (!text) return '';
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
