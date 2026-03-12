import { createServer } from 'http';
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';

/**
 * Servidor HTTP REST para control externo de Komodo via API key.
 *
 * - Autenticación via header X-Komodo-Key
 * - Configurable con API_SERVER=true, API_PORT=3002, KOMODO_API_KEY
 * - Endpoints: POST /api/run, POST /api/stop, POST /api/pause,
 *              POST /api/task, GET /api/status
 */
export class KomodoApiServer {
  /**
   * @param {Object} [options]
   * @param {number} [options.port] - Puerto del servidor (default: config.apiPort)
   * @param {Function} [options.onRun] - Callback async(tasks: number) => void para iniciar ejecución
   * @param {Function} [options.onCreateTask] - Callback async(taskData) => createdTask para crear tareas
   */
  constructor(options = {}) {
    this.port = options.port ?? config.apiPort;

    /** @type {Function|null} */
    this._onRun = options.onRun ?? null;

    /** @type {Function|null} */
    this._onCreateTask = options.onCreateTask ?? null;

    /** @type {import('http').Server|null} */
    this._httpServer = null;

    /** @type {Map<string, { count: number, resetTime: number }>} */
    this._rateLimits = new Map();
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

      // Cleanup rate limits every minute
      this._rateLimitInterval = setInterval(() => this._cleanupRateLimits(), 60000);
    });
  }

  /**
   * Detiene el servidor y libera recursos.
   *
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (this._rateLimitInterval) {
        clearInterval(this._rateLimitInterval);
      }
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
    if (!this._checkRateLimit(req, res)) return;

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

    if (method === 'POST' && path === '/api/task') {
      this._handleCreateTask(req, res);
      return;
    }

    if (method === 'GET' && path === '/api/status') {
      this._handleStatus(res);
      return;
    }

    if (method === 'POST' && path === '/api/approve') {
      this._handleApprove(res);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Verifica el rate limit por IP (60 req/min).
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {boolean} true si la petición puede proceder
   */
  _checkRateLimit(req, res) {
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    const limit = this._rateLimits.get(ip);

    if (limit && now < limit.resetTime) {
      if (limit.count >= 60) {
        res.writeHead(429);
        res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: Math.ceil((limit.resetTime - now) / 1000) }));
        return false;
      }
      limit.count++;
    } else {
      this._rateLimits.set(ip, {
        count: 1,
        resetTime: now + 60000,
      });
    }

    return true;
  }

  /**
   * Limpia registros de rate limit expirados.
   */
  _cleanupRateLimits() {
    const now = Date.now();
    for (const [ip, limit] of this._rateLimits.entries()) {
      if (now >= limit.resetTime) {
        this._rateLimits.delete(ip);
      }
    }
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

  /**
   * Lee el body JSON de una petición.
   * Limita el tamaño del body a 1 MB para evitar DoS por payloads grandes.
   *
   * @param {import('http').IncomingMessage} req
   * @returns {Promise<Object>} Body parseado (o {} si vacío)
   * @throws {Error} Si el body excede el límite o el JSON es inválido
   */
  _readBody(req) {
    const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
    return new Promise((resolve, reject) => {
      let data = '';
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          const err = new Error('Payload too large');
          err.statusCode = 413;
          reject(err);
          return;
        }
        data += chunk;
      });
      req.on('end', () => {
        if (!data) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          const err = new Error('Invalid JSON');
          err.statusCode = 400;
          reject(err);
        }
      });
      req.on('error', reject);
    });
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
      body = await this._readBody(req);
    } catch (err) {
      const status = err.statusCode || 400;
      res.writeHead(status);
      res.end(JSON.stringify({ error: err.message || 'Invalid request body' }));
      return;
    }

    const tasks = body.tasks !== undefined ? Number(body.tasks) : 1;

    if (!Number.isInteger(tasks) || tasks < 1) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'tasks must be a positive integer' }));
      return;
    }

    if (!this._onRun) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Runner not configured' }));
      return;
    }

    if (komodoState.executionState === EXECUTION_STATES.RUNNING) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: 'Komodo is already running' }));
      return;
    }

    logger.info(`Run requested via API: ${tasks} task(s)`, 'API');

    // Fire-and-forget: start the run without blocking the response
    Promise.resolve(this._onRun(tasks)).catch((err) => {
      logger.error(`API run error: ${err.message}`, 'API');
    });

    res.writeHead(200);
    res.end(JSON.stringify({ status: 'started', tasks }));
  }

  /**
   * POST /api/stop — detiene la ejecución actual.
   *
   * @param {import('http').ServerResponse} res
   */
  _handleStop(res) {
    logger.info('Stop requested via API', 'API');
    komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'stopping' }));
  }

  /**
   * POST /api/pause — pausa la ejecución actual.
   *
   * @param {import('http').ServerResponse} res
   */
  _handlePause(res) {
    logger.info('Pause requested via API', 'API');
    komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'pausing' }));
  }

  /**
   * POST /api/approve — grants approval for the current autonomy checkpoint.
   *
   * @param {import('http').ServerResponse} res
   */
  _handleApprove(res) {
    logger.info('Approval granted via API', 'API');
    komodoState.grantApproval();
    res.writeHead(200);
    res.end(JSON.stringify({ approved: true, state: komodoState.executionState }));
  }

  /**
   * POST /api/task — crea una nueva tarea en el backlog.
   * Body: { title: string, userStory: string, bizPoints: number, devPoints: number }
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  async _handleCreateTask(req, res) {
    let body;
    try {
      body = await this._readBody(req);
    } catch (err) {
      const status = err.statusCode || 400;
      res.writeHead(status);
      res.end(JSON.stringify({ error: err.message || 'Invalid request body' }));
      return;
    }

    const VALID_FIBONACCI = [1, 2, 3, 5, 8, 13];
    const errors = [];

    if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
      errors.push('title is required and must be a non-empty string');
    }
    if (!body.userStory || typeof body.userStory !== 'string' || body.userStory.trim().length === 0) {
      errors.push('userStory is required and must be a non-empty string');
    }
    if (body.bizPoints === undefined || !VALID_FIBONACCI.includes(body.bizPoints)) {
      errors.push(`bizPoints is required and must be one of: ${VALID_FIBONACCI.join(', ')}`);
    }
    if (body.devPoints === undefined || !VALID_FIBONACCI.includes(body.devPoints)) {
      errors.push(`devPoints is required and must be one of: ${VALID_FIBONACCI.join(', ')}`);
    }

    if (errors.length > 0) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Validation failed', details: errors }));
      return;
    }

    if (!this._onCreateTask) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Task creation not configured' }));
      return;
    }

    try {
      const task = await this._onCreateTask({
        title: body.title.trim(),
        userStory: body.userStory.trim(),
        bizPoints: body.bizPoints,
        devPoints: body.devPoints,
      });

      logger.info(`Task created via API: ${task.id ?? task.title}`, 'API');

      res.writeHead(201);
      res.end(JSON.stringify({ status: 'created', task }));
    } catch (err) {
      logger.error(`API task creation error: ${err.message}`, 'API');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to create task' }));
    }
  }

  /**
   * GET /api/status — devuelve el estado actual de Komodo.
   *
   * @param {import('http').ServerResponse} res
   */
  _handleStatus(res) {
    const snapshot = komodoState.getSnapshot();
    res.writeHead(200);
    res.end(JSON.stringify(snapshot));
  }
}

/**
 * Inicia el API server si API_SERVER=true.
 * Llama a esta función desde el orchestrator tras iniciar el WS server.
 *
 * @param {Object} [options]
 * @param {Function} [options.onRun] - Callback async(tasks: number) => void para /api/run
 * @param {Function} [options.onCreateTask] - Callback async(taskData) => createdTask para /api/task
 * @returns {Promise<KomodoApiServer|null>} Instancia del servidor o null si está deshabilitado
 */
export async function startApiServerIfEnabled(options = {}) {
  if (!config.apiServer) return null;

  if (!config.komodoApiKey) {
    logger.warn('API_SERVER=true pero KOMODO_API_KEY no está configurada. API server deshabilitado.', 'API');
    return null;
  }

  const server = new KomodoApiServer({
    onRun: options.onRun,
    onCreateTask: options.onCreateTask,
  });
  try {
    await server.start();
    return server;
  } catch (err) {
    logger.warn(`No se pudo iniciar API server: ${err.message}`, 'API');
    return null;
  }
}
