import { createServer } from 'http';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { create } from '../../skills/planning-task-mcp/src/firebase.js';

const AGENT = 'API';

// ── Rate limiter (in-memory, per IP) ──

/** @type {Map<string, number[]>} IP → array of request timestamps */
const requestLog = new Map();
const RATE_WINDOW_MS = 60_000;

/**
 * Checks if an IP has exceeded the rate limit.
 * Cleans up old entries as a side effect.
 *
 * @param {string} ip
 * @returns {boolean} true if rate limited
 */
export function isRateLimited(ip) {
  const now = Date.now();
  const max = config.apiRateLimitMax;

  let timestamps = requestLog.get(ip);
  if (!timestamps) {
    timestamps = [];
    requestLog.set(ip, timestamps);
  }

  // Remove entries older than the window
  const cutoff = now - RATE_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= max) {
    return true;
  }

  timestamps.push(now);
  return false;
}

/**
 * Validates the API key from request headers.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function validateApiKey(req) {
  const key = req.headers['x-komodo-key'];
  return key === config.komodoApiKey;
}

/**
 * Reads the full JSON body from an incoming request.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<object>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_BODY = 1024 * 100; // 100 KB

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Sends a JSON response.
 *
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {object} data
 */
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Extracts client IP from request (supports X-Forwarded-For).
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// ── Route handlers ──

/**
 * POST /api/run — Start execution of N tasks.
 * Body: { tasks?: number, projectId?: string }
 */
async function handleRun(req, res) {
  const body = await readBody(req);
  const tasks = body.tasks ?? 1;
  const projectId = body.projectId || config.defaultProjectId;

  if (!projectId) {
    return json(res, 400, { error: 'projectId is required (body or DEFAULT_PROJECT_ID env)' });
  }

  if (typeof tasks !== 'number' || tasks < 0) {
    return json(res, 400, { error: 'tasks must be a non-negative number' });
  }

  // Signal the orchestrator to start running
  komodoState.setExecutionState(EXECUTION_STATES.RUNNING);

  logger.info(`API: run requested — ${tasks} task(s), project ${projectId}`, AGENT);

  json(res, 202, {
    message: `Run started for ${tasks} task(s)`,
    projectId,
    tasks,
    executionState: komodoState.executionState,
  });
}

/**
 * POST /api/stop — Stop execution.
 */
async function handleStop(_req, res) {
  komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
  logger.info('API: stop requested', AGENT);
  json(res, 200, { message: 'Stop signal sent', executionState: komodoState.executionState });
}

/**
 * POST /api/pause — Pause execution.
 */
async function handlePause(_req, res) {
  komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
  logger.info('API: pause requested', AGENT);
  json(res, 200, { message: 'Pause signal sent', executionState: komodoState.executionState });
}

/**
 * POST /api/task — Create a new task.
 * Body: { title, userStory?, devPoints?, bizPoints?, projectId? }
 */
async function handleCreateTask(req, res) {
  const body = await readBody(req);
  const { title, userStory, devPoints, bizPoints, projectId } = body;

  if (!title || typeof title !== 'string') {
    return json(res, 400, { error: 'title is required and must be a string' });
  }

  const pid = projectId || config.defaultProjectId;
  if (!pid) {
    return json(res, 400, { error: 'projectId is required (body or DEFAULT_PROJECT_ID env)' });
  }

  const taskData = {
    title,
    userStory: userStory || '',
    devPoints: typeof devPoints === 'number' ? devPoints : 3,
    bizPoints: typeof bizPoints === 'number' ? bizPoints : 5,
    status: 'to-do',
    source: 'api',
    projectId: pid,
    userId: config.defaultUserId,
    userName: config.defaultUserName || 'Komodo API',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    const taskId = await create('tasks', taskData);
    logger.success(`API: task created — ${title} (${taskId})`, AGENT);
    json(res, 201, { taskId, title, projectId: pid });
  } catch (err) {
    logger.error(`API: failed to create task — ${err.message}`, AGENT);
    json(res, 500, { error: 'Failed to create task' });
  }
}

/**
 * GET /api/status — Current Komodo status.
 */
function handleStatus(_req, res) {
  const snapshot = komodoState.getSnapshot();
  json(res, 200, {
    executionState: snapshot.executionState,
    phase: snapshot.phase,
    currentTask: snapshot.currentTask,
    taskDetails: snapshot.taskDetails,
    tasksCompleted: snapshot.tasksCompleted,
    totalTasks: snapshot.totalTasks,
    agents: {
      PLANNER: { status: snapshot.agents.PLANNER.status, currentTask: snapshot.agents.PLANNER.currentTask },
      CODER: { status: snapshot.agents.CODER.status, currentTask: snapshot.agents.CODER.currentTask },
      QA: { status: snapshot.agents.QA.status, currentTask: snapshot.agents.QA.currentTask },
      REVIEWER: { status: snapshot.agents.REVIEWER.status, currentTask: snapshot.agents.REVIEWER.currentTask },
    },
    reviewCycle: snapshot.reviewCycle,
    currentPR: snapshot.currentPR,
    budget: snapshot.budget,
  });
}

// ── Route table ──

const routes = {
  'POST /api/run': handleRun,
  'POST /api/stop': handleStop,
  'POST /api/pause': handlePause,
  'POST /api/task': handleCreateTask,
  'GET /api/status': handleStatus,
};

/**
 * Komodo REST API Server.
 *
 * Provides external control of Komodo via authenticated HTTP endpoints.
 * Separated from the WebSocket dashboard server.
 */
export class KomodoApiServer {
  /**
   * @param {Object} [options]
   * @param {number} [options.port] - Port override (default: config.apiServerPort)
   * @param {string} [options.apiKey] - API key override (default: config.komodoApiKey)
   */
  constructor(options = {}) {
    this.port = options.port ?? config.apiServerPort;
    this.apiKey = options.apiKey ?? config.komodoApiKey;

    /** @type {import('http').Server|null} */
    this._server = null;
  }

  /**
   * Starts the API server.
   *
   * @returns {Promise<void>}
   */
  start() {
    if (!this.apiKey) {
      logger.warn('API server requires KOMODO_API_KEY — not starting', AGENT);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this._server = createServer((req, res) => this._handleRequest(req, res));

      this._server.on('error', (err) => reject(err));

      this._server.listen(this.port, () => {
        logger.info(`API server listening on port ${this.port}`, AGENT);
        resolve();
      });
    });
  }

  /**
   * Stops the API server.
   *
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (this._server) {
        this._server.close(() => resolve());
        this._server = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Main request handler with auth, rate limiting, CORS, and routing.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  async _handleRequest(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Komodo-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limiting
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      json(res, 429, { error: 'Rate limit exceeded. Max 60 requests per minute.' });
      return;
    }

    // Authentication
    const key = req.headers['x-komodo-key'];
    if (key !== this.apiKey) {
      json(res, 401, { error: 'Invalid or missing API key' });
      return;
    }

    // Routing
    const url = req.url?.split('?')[0]; // strip query string
    const routeKey = `${req.method} ${url}`;
    const handler = routes[routeKey];

    if (!handler) {
      json(res, 404, { error: 'Not found' });
      return;
    }

    try {
      await handler(req, res);
    } catch (err) {
      logger.error(`API error on ${routeKey}: ${err.message}`, AGENT);
      json(res, 500, { error: 'Internal server error' });
    }
  }
}
