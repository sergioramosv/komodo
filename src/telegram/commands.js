import { withAuth } from './auth.js';
import { logger } from '../utils/logger.js';
import { getStatus, getTasks, getBacklog } from './data.js';
import { formatStatus, formatTaskList, formatBacklog } from './formatter.js';
import { startExecution, stopExecution, runDryRun } from './run-controller.js';

const AGENT = 'TELEGRAM';

const COMMANDS_LIST = [
  '/start - Inicia el bot y muestra bienvenida',
  '/help - Lista de comandos disponibles',
  '/status - Estado actual de Komodo',
  '/tasks - Tareas to-do ordenadas por prioridad',
  '/backlog - Resumen del backlog y sprint activo',
  '/run - Ejecuta 1 tarea',
  '/run N - Ejecuta N tareas',
  '/run all - Ejecuta todas las tareas del backlog',
  '/dryrun - Muestra qu\u00e9 tarea se ejecutar\u00eda sin hacerlo',
  '/stop - Detiene la ejecuci\u00f3n actual',
  '',
  'Texto libre \u2192 se env\u00eda como prompt a Claude Code',
];

/**
 * Registra los comandos del bot de Telegram.
 * Cada handler usa withAuth() para verificar autorizaci\u00f3n.
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

  // --- Execution commands ---

  // /run, /run N, /run all
  bot.onText(/^\/run(?:@\w+)?(?:\s+(.+))?$/, withAuth((msg, match) => {
    try {
      const arg = (match[1] || '').trim().toLowerCase();
      let tasks;

      if (!arg || arg === '1') {
        tasks = 1;
      } else if (arg === 'all') {
        tasks = 0; // 0 = continuous (all tasks)
      } else {
        const n = parseInt(arg, 10);
        if (isNaN(n) || n < 1) {
          bot.sendMessage(msg.chat.id, 'Uso: /run, /run N, o /run all')
            .catch(e => logger.error(`sendMessage error: ${e.message}`, AGENT));
          return;
        }
        tasks = n;
      }

      startExecution(msg.chat.id, { tasks });
    } catch (err) {
      logger.error(`/run error: ${err.message}`, AGENT);
      bot.sendMessage(msg.chat.id, 'Error al iniciar ejecuci\u00f3n.')
        .catch(e => logger.error(`sendMessage error: ${e.message}`, AGENT));
    }
  }));

  // /dryrun
  bot.onText(/^\/dryrun(@\w+)?$/, withAuth(async (msg) => {
    try {
      await runDryRun(msg.chat.id);
    } catch (err) {
      logger.error(`/dryrun error: ${err.message}`, AGENT);
      bot.sendMessage(msg.chat.id, 'Error al ejecutar dry-run.')
        .catch(e => logger.error(`sendMessage error: ${e.message}`, AGENT));
    }
  }));

  // /stop
  bot.onText(/^\/stop(@\w+)?$/, withAuth((msg) => {
    try {
      stopExecution(msg.chat.id);
    } catch (err) {
      logger.error(`/stop error: ${err.message}`, AGENT);
      bot.sendMessage(msg.chat.id, 'Error al detener ejecuci\u00f3n.')
        .catch(e => logger.error(`sendMessage error: ${e.message}`, AGENT));
    }
  }));
}
