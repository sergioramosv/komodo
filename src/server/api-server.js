import { createServer } from 'http';
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { komodoState } from '../state/komodo-state.js';
import { readJsonBody, stopHttpServer, setCorsHeaders, sendJson } from '../utils/http-utils.js';
import { requestPause, requestStop, isKomodoActive } from '../utils/execution-utils.js';

/**
 * Servidor HTTP REST para control externo de Komodo via API key.
 *
 * - Autenticación via header X-Komodo-Key
 * - Configurable con API_SERVER=true, API_PORT=3002, KOMODO_API_KEY
 * - Endpoints: POST /api/run, POST /api/stop, POST /api/pause
 */
export class KomodoApiServer {
  /**
   * @param {Object} [options]
   * @param {number} [options.port] - Puerto del servidor (default: config.apiPort)
   * @param {Function} [options.onRun] - Callback async(tasks: number) => void para iniciar ejecución
   */
  constructor(options = {}) {
    this.port = options.port ?? config.apiPort;

    /** @type {Function|null} */
    this._onRun = options.onRun ?? null;

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
  async stop() {
    await stopHttpServer(this._httpServer);
    this._httpServer = null;
  }

  /**
   * Maneja todas las peticiones HTTP entrantes.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  _handleRequest(req, res) {
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (!this._authenticate(req, res)) return;

    const path = (req.url || '').split('?')[0];
    const method = req.method;

    if (method === 'POST' && path === '/api/run') {
      this._handleRun(req, res);
      return;
    }

    if (method === 'POST' && path === '/api/stop') {
      this._handleStop(res);
      return;
    }

    if (method === 'POST' && path === '/api/pause') {
      this._handlePause(res);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
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
      sendJson(res, 401, { error: 'Unauthorized' });
      return false;
    }

    const expectedBuf = Buffer.from(config.komodoApiKey);
    const providedBuf = Buffer.from(provided);

    const valid =
      expectedBuf.length === providedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf);

    if (!valid) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return false;
    }

    return true;
  }

  /**
   * POST /api/run — inicia ejecución de N tareas.
   * Body: { tasks: number } (default: 1)
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  async _handleRun(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Invalid request body' });
      return;
    }

    const tasks = body.tasks !== undefined ? Number(body.tasks) : 1;

    if (!Number.isInteger(tasks) || tasks < 1) {
      sendJson(res, 400, { error: 'tasks must be a positive integer' });
      return;
    }

    if (!this._onRun) {
      sendJson(res, 503, { error: 'Runner not configured' });
      return;
    }

    if (isKomodoActive()) {
      sendJson(res, 409, { error: `Komodo is already active (state: ${komodoState.executionState})` });
      return;
    }

    logger.info(`Run requested via API: ${tasks} task(s)`, 'API');

    // Fire-and-forget: start the run without blocking the response
    this._onRun(tasks).catch((err) => {
      logger.error(`API run error: ${err.message}`, 'API');
    });

    sendJson(res, 200, { status: 'started', tasks });
  }

  /**
   * POST /api/stop — detiene la ejecución actual.
   *
   * @param {import('http').ServerResponse} res
   */
  _handleStop(res) {
    requestStop('API');
    sendJson(res, 200, { status: 'stopping' });
  }

  /**
   * POST /api/pause — pausa la ejecución actual.
   *
   * @param {import('http').ServerResponse} res
   */
  _handlePause(res) {
    requestPause('API');
    sendJson(res, 200, { status: 'pausing' });
  }
}

/**
 * Inicia el API server si API_SERVER=true.
 * Llama a esta función desde el orchestrator tras iniciar el WS server.
 *
 * @param {Object} [options]
 * @param {Function} [options.onRun] - Callback async(tasks: number) => void para /api/run
 * @returns {Promise<KomodoApiServer|null>} Instancia del servidor o null si está deshabilitado
 */
export async function startApiServerIfEnabled(options = {}) {
  if (!config.apiServer) return null;

  if (!config.komodoApiKey) {
    logger.warn('API_SERVER=true pero KOMODO_API_KEY no está configurada. API server deshabilitado.', 'API');
    return null;
  }

  const server = new KomodoApiServer({ onRun: options.onRun });
  try {
    await server.start();
    return server;
  } catch (err) {
    logger.warn(`No se pudo iniciar API server: ${err.message}`, 'API');
    return null;
  }
}
