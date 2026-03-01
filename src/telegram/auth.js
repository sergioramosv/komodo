import { config } from '../config.js';

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
