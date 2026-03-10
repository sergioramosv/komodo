import { KomodoWsServer } from './ws-server.js';
import { startApiServerIfEnabled } from './api-server.js';
import { shutdownManager } from '../shutdown/shutdown-manager.js';
import { logger } from '../utils/logger.js';

/**
 * @typedef {Object} KomodoServers
 * @property {KomodoWsServer} wsServer
 * @property {import('./api-server.js').KomodoApiServer|null} apiServer
 */

/**
 * Inicia los servidores (WS y API si está habilitado).
 * Registra los servidores en el shutdown manager.
 *
 * @param {Object} [options]
 * @param {string} [options.source='KOMODO'] - Etiqueta para el logger
 * @param {Function} [options.onRun] - Callback para /api/run
 * @returns {Promise<KomodoServers>}
 */
export async function startServers(options = {}) {
  const source = options.source || 'KOMODO';

  // WebSocket Server
  const wsServer = new KomodoWsServer();
  try {
    await wsServer.start();
  } catch (err) {
    logger.warn(`No se pudo iniciar WS server: ${err.message}`, source);
  }

  // API Server
  const apiServer = await startApiServerIfEnabled({ onRun: options.onRun });

  // Register for graceful shutdown
  shutdownManager.register({ wsServer, apiServer });

  return { wsServer, apiServer };
}

/**
 * Detiene los servidores y limpia el shutdown manager.
 *
 * @param {KomodoServers} servers
 * @returns {Promise<void>}
 */
export async function stopServers(servers) {
  const { wsServer, apiServer } = servers;

  shutdownManager.unregister();

  if (apiServer) {
    await apiServer.stop();
  }

  if (wsServer) {
    await wsServer.stop();
  }
}
