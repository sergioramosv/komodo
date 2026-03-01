import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { isAuthorized } from './auth.js';
import { registerCommands } from './commands.js';

const AGENT = 'TELEGRAM';

let bot = null;

/**
 * Inicia el bot de Telegram si está habilitado y configurado.
 * @returns {TelegramBot|null} Instancia del bot o null si no arranca.
 */
export function startBot() {
  if (!config.enableTelegram) {
    logger.info('Telegram bot disabled (ENABLE_TELEGRAM=false)', AGENT);
    return null;
  }

  if (!config.telegramBotToken) {
    logger.warn('Telegram bot token missing. Set TELEGRAM_BOT_TOKEN in .env', AGENT);
    return null;
  }

  bot = new TelegramBot(config.telegramBotToken, { polling: true });

  // Auth middleware: intercept all messages before processing
  bot.on('message', (msg) => {
    if (!isAuthorized(msg.from.id)) {
      logger.warn(`Unauthorized message from user ${msg.from.id} (@${msg.from.username || 'unknown'})`, AGENT);
      return;
    }
  });

  // Register commands
  registerCommands(bot);

  logger.success('Telegram bot started', AGENT);
  return bot;
}

/**
 * Detiene el bot de Telegram.
 */
export async function stopBot() {
  if (!bot) return;

  try {
    await bot.stopPolling();
    bot = null;
    logger.info('Telegram bot stopped', AGENT);
  } catch (err) {
    logger.error(`Error stopping Telegram bot: ${err.message}`, AGENT);
  }
}

/**
 * Devuelve la instancia actual del bot (o null).
 * @returns {TelegramBot|null}
 */
export function getBot() {
  return bot;
}
