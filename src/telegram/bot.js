import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { registerCommands } from './commands.js';
import { registerTerminalHandler } from './claude-terminal.js';
import { startNotifier, stopNotifier } from './notifier.js';

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

  // Log all incoming messages (auth is handled per-handler via withAuth)
  bot.on('message', (msg) => {
    logger.info(`Message from ${msg.from.id} (@${msg.from.username || 'unknown'}): ${msg.text || '[non-text]'}`, AGENT);
  });

  // Handle polling errors
  bot.on('polling_error', (err) => {
    logger.error(`Polling error: ${err.message}`, AGENT);
  });

  // Register commands
  registerCommands(bot);

  // Register free-text terminal handler (non-command messages → Claude Code)
  registerTerminalHandler(bot);

  // Start EventBus → Telegram notifications
  startNotifier();

  logger.success('Telegram bot started', AGENT);
  return bot;
}

/**
 * Detiene el bot de Telegram.
 */
export async function stopBot() {
  if (!bot) return;

  try {
    stopNotifier();
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
