import { createServer } from 'http';
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Servidor HTTP REST para control externo de Komodo via API key.
 *
 * - Autenticación via header X-Komodo-Key
 * - Configurable con API_SERVER=true, API_PORT=3002, KOMODO_API_KEY
 * - Diseñado para ser extendido con endpoints de control
 */
export class KomodoApiServer {
  /**
   * @param {Object} [options]
   * @param {number} [options.port] - Puerto del servidor (default: config.apiPort)
   */
  constructor(options = {}) {
    this.port = options.port ?? config.apiPort;

    /** @type {import('http').Server|null} */
    this._httpServer = null;
  }

  /**
   * Inicia el servidor HTTP.
   *
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this._httpServer = createServer((req, res) => this._handleRequest(req, res));

      this._httpServer.on('error', (err) => {
        reject(err);
      });

      this._httpServer.listen(this.port, () => {
        logger.info(`API server escuchando en puerto ${this.port}`, 'API');
        resolve();
      });
    });
  }

  /**
   * Detiene el servidor y libera recursos.
   *
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (this._httpServer) {
        this._httpServer.close(() => resolve());
        this._httpServer = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Maneja todas las peticiones HTTP entrantes.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  _handleRequest(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'X-Komodo-Key, Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }

    if (!this._authenticate(req, res)) return;

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Valida el header X-Komodo-Key contra KOMODO_API_KEY.
   * Responde con 401 si la clave es inválida o está ausente.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {boolean} true si la autenticación es válida
   */
  _authenticate(req, res) {
    const provided = req.headers['x-komodo-key'];

    if (!provided) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return false;
    }

    const expectedBuf = Buffer.from(config.komodoApiKey);
    const providedBuf = Buffer.from(provided);

    const valid =
      expectedBuf.length === providedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf);

    if (!valid) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return false;
    }

    return true;
  }
}

/**
 * Inicia el API server si API_SERVER=true.
 * Llama a esta función desde el orchestrator tras iniciar el WS server.
 *
 * @returns {Promise<KomodoApiServer|null>} Instancia del servidor o null si está deshabilitado
 */
export async function startApiServerIfEnabled() {
  if (!config.apiServer) return null;

  if (!config.komodoApiKey) {
    logger.warn('API_SERVER=true pero KOMODO_API_KEY no está configurada. API server deshabilitado.', 'API');
    return null;
  }

  const server = new KomodoApiServer();
  try {
    await server.start();
    return server;
  } catch (err) {
    logger.warn(`No se pudo iniciar API server: ${err.message}`, 'API');
    return null;
  }
}
