import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const AGENT = 'TELEGRAM';

/**
 * Verifica si un usuario de Telegram está autorizado.
 * Compara el ID numérico del usuario contra la whitelist de TELEGRAM_ALLOWED_USERS.
 * Si la whitelist está vacía, todos los usuarios son rechazados.
 *
 * @param {number} userId - ID numérico del usuario de Telegram.
 * @returns {boolean}
 */
export function isAuthorized(userId) {
  const { telegramAllowedUsers } = config;

  if (telegramAllowedUsers.length === 0) {
    return false;
  }

  return telegramAllowedUsers.includes(String(userId));
}

/**
 * Wrapper que envuelve un handler del bot con verificación de auth.
 * Si el usuario no está autorizado, el handler no se ejecuta.
 *
 * @param {function} handler - Handler original (msg, match?) => void
 * @returns {function} Handler envuelto con auth check
 */
export function withAuth(handler) {
  return (msg, match) => {
    if (!isAuthorized(msg.from.id)) {
      logger.warn(`Unauthorized access attempt from user ${msg.from.id} (@${msg.from.username || 'unknown'})`, AGENT);
      return;
    }
    handler(msg, match);
  };
}
