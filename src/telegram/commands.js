import { withAuth } from './auth.js';
import { logger } from '../utils/logger.js';
import { getStatus, getTasks, getBacklog } from './data.js';
import { formatStatus, formatTaskList, formatBacklog } from './formatter.js';

const AGENT = 'TELEGRAM';

const COMMANDS_LIST = [
  '/start - Inicia el bot y muestra bienvenida',
  '/help - Lista de comandos disponibles',
  '/status - Estado actual de Komodo',
  '/tasks - Tareas to-do ordenadas por prioridad',
  '/backlog - Resumen del backlog y sprint activo',
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

  bot.onText(/^\/status(@\w+)?$/, withAuth((msg) => {
    try {
      const status = getStatus();
      const text = formatStatus(status);
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' })
        .catch(err => logger.error(`sendMessage error: ${err.message}`, AGENT));
    } catch (err) {
      logger.error(`/status error: ${err.message}`, AGENT);
      bot.sendMessage(msg.chat.id, 'Error al obtener el estado.')
        .catch(e => logger.error(`sendMessage error: ${e.message}`, AGENT));
    }
  }));

  bot.onText(/^\/tasks(@\w+)?$/, withAuth(async (msg) => {
    try {
      const tasks = await getTasks();
      const text = formatTaskList(tasks);
      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      logger.error(`/tasks error: ${err.message}`, AGENT);
      bot.sendMessage(msg.chat.id, 'Error al obtener las tareas.')
        .catch(e => logger.error(`sendMessage error: ${e.message}`, AGENT));
    }
  }));

  bot.onText(/^\/backlog(@\w+)?$/, withAuth(async (msg) => {
    try {
      const backlog = await getBacklog();
      const text = formatBacklog(backlog);
      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      logger.error(`/backlog error: ${err.message}`, AGENT);
      bot.sendMessage(msg.chat.id, 'Error al obtener el backlog.')
        .catch(e => logger.error(`sendMessage error: ${e.message}`, AGENT));
    }
  }));
}
