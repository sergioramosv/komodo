import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getBot } from './bot.js';
import {
  formatTaskStarted,
  formatPRCreated,
  formatReviewCycleEnd,
  formatFixDone,
  formatPRMerged,
  formatTaskCompleted,
  formatError,
  formatCliRecovered,
  formatAllClisRateLimited,
} from './formatter.js';

const AGENT = 'TELEGRAM';

/** Unsubscribe functions for active listeners. */
let unsubscribers = [];

/**
 * Events that are always sent (minimal + verbose).
 */
const MINIMAL_EVENTS = new Set([
  EVENT_TYPES.TASK_STARTED,
  EVENT_TYPES.TASK_COMPLETED,
  EVENT_TYPES.PR_MERGED,
  EVENT_TYPES.CLI_RECOVERED,
  EVENT_TYPES.ALL_CLIS_RATE_LIMITED,
  // Errors are handled separately via TASK_COMPLETED with success=false
]);

/**
 * Events only sent in verbose mode.
 */
const VERBOSE_EVENTS = new Set([
  EVENT_TYPES.PR_CREATED,
  EVENT_TYPES.REVIEW_CYCLE_END,
]);

/**
 * Sends a MarkdownV2 message to the configured Telegram chat.
 * @param {string} text - MarkdownV2 formatted text
 */
function sendNotification(text) {
  const bot = getBot();
  const chatId = config.telegramChatId;

  if (!bot || !chatId) return;

  bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' }).catch(err => {
    logger.error(`Failed to send notification: ${err.message}`, AGENT);
  });
}

/**
 * Checks whether an event should be sent based on verbosity level.
 * @param {string} eventType
 * @returns {boolean}
 */
export function shouldNotify(eventType) {
  const verbosity = config.telegramVerbosity;

  if (MINIMAL_EVENTS.has(eventType)) return true;
  if (verbosity === 'verbose' && VERBOSE_EVENTS.has(eventType)) return true;

  return false;
}

/**
 * Registers EventBus listeners for Telegram notifications.
 * Call this after the bot has started.
 */
export function startNotifier() {
  if (!config.enableTelegram || !config.telegramChatId) {
    return;
  }

  logger.info(`Notifications enabled (verbosity: ${config.telegramVerbosity})`, AGENT);

  // --- TASK_STARTED (Planner eligió tarea) ---
  const onTaskStarted = (payload) => {
    if (!shouldNotify(EVENT_TYPES.TASK_STARTED)) return;
    sendNotification(formatTaskStarted(payload.metadata));
  };
  eventBus.on(EVENT_TYPES.TASK_STARTED, onTaskStarted);
  unsubscribers.push(() => eventBus.off(EVENT_TYPES.TASK_STARTED, onTaskStarted));

  // --- PR_CREATED (Coder creó PR) ---
  const onPRCreated = (payload) => {
    if (!shouldNotify(EVENT_TYPES.PR_CREATED)) return;
    sendNotification(formatPRCreated(payload.metadata));
  };
  eventBus.on(EVENT_TYPES.PR_CREATED, onPRCreated);
  unsubscribers.push(() => eventBus.off(EVENT_TYPES.PR_CREATED, onPRCreated));

  // --- REVIEW_CYCLE_END (Reviewer terminó) ---
  const onReviewCycleEnd = (payload) => {
    if (!shouldNotify(EVENT_TYPES.REVIEW_CYCLE_END)) return;
    sendNotification(formatReviewCycleEnd(payload.metadata));
  };
  eventBus.on(EVENT_TYPES.REVIEW_CYCLE_END, onReviewCycleEnd);
  unsubscribers.push(() => eventBus.off(EVENT_TYPES.REVIEW_CYCLE_END, onReviewCycleEnd));

  // --- CODER FIX DONE (verbose only) ---
  // Coder emits agent:coder:done — we detect fix context via metadata.fixing
  const onCoderDone = (payload) => {
    if (config.telegramVerbosity !== 'verbose') return;
    if (!payload.metadata?.fixing) return;
    sendNotification(formatFixDone(payload.metadata));
  };
  eventBus.on(EVENT_TYPES.AGENT_CODER_DONE, onCoderDone);
  unsubscribers.push(() => eventBus.off(EVENT_TYPES.AGENT_CODER_DONE, onCoderDone));

  // --- PR_MERGED ---
  const onPRMerged = (payload) => {
    if (!shouldNotify(EVENT_TYPES.PR_MERGED)) return;
    sendNotification(formatPRMerged(payload.metadata));
  };
  eventBus.on(EVENT_TYPES.PR_MERGED, onPRMerged);
  unsubscribers.push(() => eventBus.off(EVENT_TYPES.PR_MERGED, onPRMerged));

  // --- TASK_COMPLETED (resumen final o error) ---
  const onTaskCompleted = (payload) => {
    if (!shouldNotify(EVENT_TYPES.TASK_COMPLETED)) return;
    const meta = payload.metadata;
    if (meta.approved) {
      sendNotification(formatTaskCompleted(meta));
    } else {
      sendNotification(formatError(meta));
    }
  };
  eventBus.on(EVENT_TYPES.TASK_COMPLETED, onTaskCompleted);
  unsubscribers.push(() => eventBus.off(EVENT_TYPES.TASK_COMPLETED, onTaskCompleted));

  // --- CLI_RECOVERED (CLI se recuperó del rate limit) ---
  const onCliRecovered = (payload) => {
    if (!shouldNotify(EVENT_TYPES.CLI_RECOVERED)) return;
    sendNotification(formatCliRecovered(payload.metadata));
  };
  eventBus.on(EVENT_TYPES.CLI_RECOVERED, onCliRecovered);
  unsubscribers.push(() => eventBus.off(EVENT_TYPES.CLI_RECOVERED, onCliRecovered));

  // --- ALL_CLIS_RATE_LIMITED (todos los CLIs en cooldown) ---
  const onAllClisRateLimited = (payload) => {
    if (!shouldNotify(EVENT_TYPES.ALL_CLIS_RATE_LIMITED)) return;
    sendNotification(formatAllClisRateLimited(payload.metadata));
  };
  eventBus.on(EVENT_TYPES.ALL_CLIS_RATE_LIMITED, onAllClisRateLimited);
  unsubscribers.push(() => eventBus.off(EVENT_TYPES.ALL_CLIS_RATE_LIMITED, onAllClisRateLimited));
}

/**
 * Removes all EventBus listeners registered by the notifier.
 */
export function stopNotifier() {
  for (const unsub of unsubscribers) {
    try { unsub(); } catch { /* ignore */ }
  }
  unsubscribers = [];
  logger.info('Notifications stopped', AGENT);
}
