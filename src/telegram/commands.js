import { withAuth } from './auth.js';
import { logger } from '../utils/logger.js';

const AGENT = 'TELEGRAM';

const COMMANDS_LIST = [
  '/start - Inicia el bot y muestra bienvenida',
  '/help - Lista de comandos disponibles',
];

/**
 * Registra los comandos del bot de Telegram.
 * Cada handler usa withAuth() para verificar autorización.
 *
 * @param {import('node-telegram-bot-api')} bot
 */
export function registerCommands(bot) {
  bot.onText(/^\/start(@\w+)?$/, withAuth((msg) => {
    const name = msg.from.first_name || 'usuario';
    bot.sendMessage(
      msg.chat.id,
      `Hola ${name}! Soy el bot de Komodo, tu orquestador de agentes IA.\n\nUsa /help para ver los comandos disponibles.`
    ).catch(err => logger.error(`sendMessage error: ${err.message}`, AGENT));
  }));

  bot.onText(/^\/help(@\w+)?$/, withAuth((msg) => {
    bot.sendMessage(
      msg.chat.id,
      `Comandos disponibles:\n\n${COMMANDS_LIST.join('\n')}`
    ).catch(err => logger.error(`sendMessage error: ${err.message}`, AGENT));
  }));
}
