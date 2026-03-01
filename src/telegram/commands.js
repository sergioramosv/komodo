import { isAuthorized } from './auth.js';

const COMMANDS_LIST = [
  '/start - Inicia el bot y muestra bienvenida',
  '/help - Lista de comandos disponibles',
];

/**
 * Registra los comandos del bot de Telegram.
 * Cada handler verifica autorización antes de responder.
 *
 * @param {import('node-telegram-bot-api')} bot
 */
export function registerCommands(bot) {
  bot.onText(/\/start/, (msg) => {
    if (!isAuthorized(msg.from.id)) return;

    const name = msg.from.first_name || 'usuario';
    bot.sendMessage(
      msg.chat.id,
      `Hola ${name}! Soy el bot de Komodo, tu orquestador de agentes IA.\n\nUsa /help para ver los comandos disponibles.`
    );
  });

  bot.onText(/\/help/, (msg) => {
    if (!isAuthorized(msg.from.id)) return;

    bot.sendMessage(
      msg.chat.id,
      `Comandos disponibles:\n\n${COMMANDS_LIST.join('\n')}`
    );
  });
}
