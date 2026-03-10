import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { getBot } from './bot.js';
import { collectWeeklyMetrics } from '../metrics/weekly-metrics.js';
import { formatWeeklyDigest } from './formatter.js';

const AGENT = 'DIGEST';

/**
 * Collects weekly metrics for the default project and sends
 * a formatted digest message via Telegram.
 *
 * @param {Object} [options]
 * @param {string} [options.projectId] - Override project ID (defaults to config.defaultProjectId)
 * @param {Date} [options.referenceDate] - Reference date for week calculation
 * @param {string} [options.chatId] - Override chat ID (defaults to config.telegramChatId)
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
export async function sendWeeklyDigest({ projectId, referenceDate, chatId } = {}) {
  const pid = projectId || config.defaultProjectId;
  const targetChat = chatId || config.telegramChatId;

  if (!pid) {
    const msg = 'No projectId configured for weekly digest';
    logger.warn(msg, AGENT);
    return { success: false, error: msg };
  }

  const bot = getBot();
  if (!bot || !targetChat) {
    const msg = 'Telegram bot or chatId not available';
    logger.warn(msg, AGENT);
    return { success: false, error: msg };
  }

  try {
    logger.info(`Collecting weekly metrics for project ${pid}...`, AGENT);
    const metrics = await collectWeeklyMetrics(pid, { referenceDate });
    const text = formatWeeklyDigest(metrics);

    await bot.sendMessage(targetChat, text, { parse_mode: 'MarkdownV2' });

    logger.success(`Weekly digest sent to chat ${targetChat}`, AGENT);
    return { success: true, message: text };
  } catch (err) {
    logger.error(`Failed to send weekly digest: ${err.message}`, AGENT);
    return { success: false, error: err.message };
  }
}
