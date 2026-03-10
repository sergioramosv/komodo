import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../config.js', () => ({
  config: { apiServer: false, apiPort: 3099, komodoApiKey: 'test-secret' },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../state/komodo-state.js', () => ({
  komodoState: {
    executionState: 'stopped',
    setExecutionState: vi.fn(),
    getSnapshot: vi.fn(() => ({
      phase: 'idle',
      currentTask: null,
      executionState: 'stopped',
      agents: {
        PLANNER: { name: 'PLANNER', status: 'idle' },
        CODER: { name: 'CODER', status: 'idle' },
        QA: { name: 'QA', status: 'idle' },
        REVIEWER: { name: 'REVIEWER', status: 'idle' },
      },
      tasksCompleted: 0,
      totalTasks: 0,
      totalCost: 0,
    })),
  },
  EXECUTION_STATES: {
    STOPPED: 'stopped',
    RUNNING: 'running',
    PAUSED: 'paused',
  },
}));

const { config } = await import('../config.js');
const { komodoState, EXECUTION_STATES } = await import('../state/komodo-state.js');
const { KomodoApiServer, startApiServerIfEnabled } = await import('./api-server.js');

// --- helpers ---

function makeReqRes(headers = {}, method = 'GET', url = '/') {
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(status) { this._status = status; },
    end(body) { this._body = body ?? null; },
  };
  const req = { method, headers, url };
  return { req, res };
}

/**
 * Creates a mock req with streaming body support.
 */
function makeStreamReq(headers = {}, method = 'POST', url = '/', bodyObj = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;
  req.url = url;

  // Emit data and end asynchronously so handlers are attached first
  process.nextTick(() => {
    if (Object.keys(bodyObj).length > 0) {
      req.emit('data', JSON.stringify(bodyObj));
    }
    req.emit('end');
  });

  return req;
}

function makeStreamRes() {
  return {
    _status: null,
    _body: null,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(status) { this._status = status; },
    end(body) { this._body = body ?? null; },
  };
}

// --- _authenticate() ---

describe('KomodoApiServer._authenticate()', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    server = new KomodoApiServer({ port: 3099 });
  });

  it('returns true when key matches', () => {
    const { req, res } = makeReqRes({ 'x-komodo-key': 'test-secret' });
    expect(server._authenticate(req, res)).toBe(true);
    expect(res._status).toBeNull();
  });

  it('returns false and sends 401 when key is wrong', () => {
    const { req, res } = makeReqRes({ 'x-komodo-key': 'wrong-key' });
    expect(server._authenticate(req, res)).toBe(false);
    expect(res._status).toBe(401);
  });

  it('returns false and sends 401 when header is absent', () => {
    const { req, res } = makeReqRes({});
    expect(server._authenticate(req, res)).toBe(false);
    expect(res._status).toBe(401);
  });

  it('rejects a key that is a prefix of the correct key', () => {
    const { req, res } = makeReqRes({ 'x-komodo-key': 'test-secre' });
    expect(server._authenticate(req, res)).toBe(false);
    expect(res._status).toBe(401);
  });
});

// --- OPTIONS CORS headers ---

describe('KomodoApiServer OPTIONS handler', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    server = new KomodoApiServer({ port: 3099 });
  });

  it('returns 204 with CORS headers for OPTIONS', () => {
    const { req, res } = makeReqRes({}, 'OPTIONS');
    server._handleRequest(req, res);
    expect(res._status).toBe(204);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res._headers['Access-Control-Allow-Headers']).toMatch(/X-Komodo-Key/i);
  });
});

// --- POST /api/stop ---

describe('POST /api/stop', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    server = new KomodoApiServer({ port: 3099 });
    vi.clearAllMocks();
  });

  it('returns 401 without auth', () => {
    const { req, res } = makeReqRes({}, 'POST', '/api/stop');
    server._handleRequest(req, res);
    expect(res._status).toBe(401);
  });

  it('sets execution state to STOPPED and returns 200', () => {
    const { req, res } = makeReqRes({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/stop');
    server._handleRequest(req, res);
    expect(komodoState.setExecutionState).toHaveBeenCalledWith(EXECUTION_STATES.STOPPED);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.status).toBe('stopping');
  });
});

// --- POST /api/pause ---

describe('POST /api/pause', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    server = new KomodoApiServer({ port: 3099 });
    vi.clearAllMocks();
  });

  it('returns 401 without auth', () => {
    const { req, res } = makeReqRes({}, 'POST', '/api/pause');
    server._handleRequest(req, res);
    expect(res._status).toBe(401);
  });

  it('sets execution state to PAUSED and returns 200', () => {
    const { req, res } = makeReqRes({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/pause');
    server._handleRequest(req, res);
    expect(komodoState.setExecutionState).toHaveBeenCalledWith(EXECUTION_STATES.PAUSED);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.status).toBe('pausing');
  });
});

// --- POST /api/run ---

describe('POST /api/run', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    komodoState.executionState = EXECUTION_STATES.STOPPED;
    vi.clearAllMocks();
  });

  it('returns 401 without auth', () => {
    const req = makeStreamReq({}, 'POST', '/api/run', { tasks: 1 });
    const res = makeStreamRes();
    server = new KomodoApiServer({ port: 3099 });
    server._handleRequest(req, res);
    // Auth check happens before body read
    expect(res._status).toBe(401);
  });

  it('returns 503 when no onRun callback is configured', async () => {
    server = new KomodoApiServer({ port: 3099 });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/run', { tasks: 2 });
    const res = makeStreamRes();
    await server._handleRun(req, res);
    expect(res._status).toBe(503);
    expect(JSON.parse(res._body).error).toMatch(/not configured/i);
  });

  it('returns 400 when tasks is not a positive integer', async () => {
    server = new KomodoApiServer({ port: 3099, onRun: vi.fn() });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/run', { tasks: 0 });
    const res = makeStreamRes();
    await server._handleRun(req, res);
    expect(res._status).toBe(400);
  });

  it('returns 400 when tasks is negative', async () => {
    server = new KomodoApiServer({ port: 3099, onRun: vi.fn() });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/run', { tasks: -1 });
    const res = makeStreamRes();
    await server._handleRun(req, res);
    expect(res._status).toBe(400);
  });

  it('returns 409 when Komodo is already running', async () => {
    komodoState.executionState = EXECUTION_STATES.RUNNING;
    server = new KomodoApiServer({ port: 3099, onRun: vi.fn() });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/run', { tasks: 1 });
    const res = makeStreamRes();
    await server._handleRun(req, res);
    expect(res._status).toBe(409);
  });

  it('returns 200 and starts run with default tasks=1 when body is empty', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    server = new KomodoApiServer({ port: 3099, onRun });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/run', {});
    const res = makeStreamRes();
    await server._handleRun(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.status).toBe('started');
    expect(body.tasks).toBe(1);
    expect(onRun).toHaveBeenCalledWith(1);
  });

  it('returns 200 and starts run with provided tasks count', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    server = new KomodoApiServer({ port: 3099, onRun });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/run', { tasks: 3 });
    const res = makeStreamRes();
    await server._handleRun(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.status).toBe('started');
    expect(body.tasks).toBe(3);
    expect(onRun).toHaveBeenCalledWith(3);
  });
});

// --- POST /api/task ---

describe('POST /api/task', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    vi.clearAllMocks();
  });

  it('returns 401 without auth', () => {
    const req = makeStreamReq({}, 'POST', '/api/task', { title: 'Test' });
    const res = makeStreamRes();
    server = new KomodoApiServer({ port: 3099 });
    server._handleRequest(req, res);
    expect(res._status).toBe(401);
  });

  it('returns 400 when title is missing', async () => {
    server = new KomodoApiServer({ port: 3099, onCreateTask: vi.fn() });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/task', {
      userStory: 'As a user I want X',
      bizPoints: 3,
      devPoints: 5,
    });
    const res = makeStreamRes();
    await server._handleCreateTask(req, res);
    expect(res._status).toBe(400);
    const body = JSON.parse(res._body);
    expect(body.error).toBe('Validation failed');
    expect(body.details).toEqual(expect.arrayContaining([expect.stringMatching(/title/)]));
  });

  it('returns 400 when userStory is missing', async () => {
    server = new KomodoApiServer({ port: 3099, onCreateTask: vi.fn() });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/task', {
      title: 'My task',
      bizPoints: 3,
      devPoints: 5,
    });
    const res = makeStreamRes();
    await server._handleCreateTask(req, res);
    expect(res._status).toBe(400);
    const body = JSON.parse(res._body);
    expect(body.details).toEqual(expect.arrayContaining([expect.stringMatching(/userStory/)]));
  });

  it('returns 400 when bizPoints is not a valid Fibonacci number', async () => {
    server = new KomodoApiServer({ port: 3099, onCreateTask: vi.fn() });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/task', {
      title: 'My task',
      userStory: 'As a user I want X',
      bizPoints: 4,
      devPoints: 5,
    });
    const res = makeStreamRes();
    await server._handleCreateTask(req, res);
    expect(res._status).toBe(400);
    const body = JSON.parse(res._body);
    expect(body.details).toEqual(expect.arrayContaining([expect.stringMatching(/bizPoints/)]));
  });

  it('returns 400 when devPoints is not a valid Fibonacci number', async () => {
    server = new KomodoApiServer({ port: 3099, onCreateTask: vi.fn() });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/task', {
      title: 'My task',
      userStory: 'As a user I want X',
      bizPoints: 3,
      devPoints: 7,
    });
    const res = makeStreamRes();
    await server._handleCreateTask(req, res);
    expect(res._status).toBe(400);
    const body = JSON.parse(res._body);
    expect(body.details).toEqual(expect.arrayContaining([expect.stringMatching(/devPoints/)]));
  });

  it('returns 400 when multiple fields are missing', async () => {
    server = new KomodoApiServer({ port: 3099, onCreateTask: vi.fn() });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/task', {});
    const res = makeStreamRes();
    await server._handleCreateTask(req, res);
    expect(res._status).toBe(400);
    const body = JSON.parse(res._body);
    expect(body.details.length).toBe(4);
  });

  it('returns 503 when onCreateTask callback is not configured', async () => {
    server = new KomodoApiServer({ port: 3099 });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/task', {
      title: 'My task',
      userStory: 'As a user I want X',
      bizPoints: 3,
      devPoints: 5,
    });
    const res = makeStreamRes();
    await server._handleCreateTask(req, res);
    expect(res._status).toBe(503);
    expect(JSON.parse(res._body).error).toMatch(/not configured/i);
  });

  it('returns 201 with created task on success', async () => {
    const createdTask = { id: 'task-123', title: 'My task', bizPoints: 3, devPoints: 5 };
    const onCreateTask = vi.fn().mockResolvedValue(createdTask);
    server = new KomodoApiServer({ port: 3099, onCreateTask });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/task', {
      title: 'My task',
      userStory: 'As a user I want X',
      bizPoints: 3,
      devPoints: 5,
    });
    const res = makeStreamRes();
    await server._handleCreateTask(req, res);
    expect(res._status).toBe(201);
    const body = JSON.parse(res._body);
    expect(body.status).toBe('created');
    expect(body.task).toEqual(createdTask);
    expect(onCreateTask).toHaveBeenCalledWith({
      title: 'My task',
      userStory: 'As a user I want X',
      bizPoints: 3,
      devPoints: 5,
    });
  });

  it('returns 500 when onCreateTask throws', async () => {
    const onCreateTask = vi.fn().mockRejectedValue(new Error('DB error'));
    server = new KomodoApiServer({ port: 3099, onCreateTask });
    const req = makeStreamReq({ 'x-komodo-key': 'test-secret' }, 'POST', '/api/task', {
      title: 'My task',
      userStory: 'As a user I want X',
      bizPoints: 3,
      devPoints: 5,
    });
    const res = makeStreamRes();
    await server._handleCreateTask(req, res);
    expect(res._status).toBe(500);
    expect(JSON.parse(res._body).error).toMatch(/failed/i);
  });
});

// --- GET /api/status ---

describe('GET /api/status', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    server = new KomodoApiServer({ port: 3099 });
    vi.clearAllMocks();
  });

  it('returns 401 without auth', () => {
    const { req, res } = makeReqRes({}, 'GET', '/api/status');
    server._handleRequest(req, res);
    expect(res._status).toBe(401);
  });

  it('returns 200 with state snapshot', () => {
    const { req, res } = makeReqRes({ 'x-komodo-key': 'test-secret' }, 'GET', '/api/status');
    server._handleRequest(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.phase).toBe('idle');
    expect(body.executionState).toBe('stopped');
    expect(body.agents).toBeDefined();
    expect(body.agents.PLANNER).toBeDefined();
    expect(komodoState.getSnapshot).toHaveBeenCalled();
  });
});

// --- _readBody edge cases ---

describe('_readBody', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    server = new KomodoApiServer({ port: 3099 });
  });

  it('rejects with 400 on invalid JSON', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.headers = {};
    req.url = '/';
    process.nextTick(() => {
      req.emit('data', 'not valid json{{{');
      req.emit('end');
    });
    await expect(server._readBody(req)).rejects.toThrow('Invalid JSON');
  });

  it('rejects with 413 on oversized body', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.headers = {};
    req.url = '/';
    req.destroy = vi.fn();
    process.nextTick(() => {
      // Send a chunk larger than 1MB
      const largeChunk = Buffer.alloc(1024 * 1024 + 1, 'a');
      req.emit('data', largeChunk);
    });
    await expect(server._readBody(req)).rejects.toThrow('Payload too large');
  });

  it('resolves {} on empty body', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.headers = {};
    req.url = '/';
    process.nextTick(() => {
      req.emit('end');
    });
    const result = await server._readBody(req);
    expect(result).toEqual({});
  });
});

// --- Unknown routes ---

describe('Unknown routes', () => {
  let server;

  beforeEach(() => {
    config.komodoApiKey = 'test-secret';
    server = new KomodoApiServer({ port: 3099 });
  });

  it('returns 404 for unknown GET route', () => {
    const { req, res } = makeReqRes({ 'x-komodo-key': 'test-secret' }, 'GET', '/api/unknown');
    server._handleRequest(req, res);
    expect(res._status).toBe(404);
  });
});

// --- startApiServerIfEnabled() ---

describe('startApiServerIfEnabled()', () => {
  afterEach(async () => {
    // reset to safe defaults
    config.apiServer = false;
    config.komodoApiKey = 'test-secret';
  });

  it('returns null when apiServer is false', async () => {
    config.apiServer = false;
    const result = await startApiServerIfEnabled();
    expect(result).toBeNull();
  });

  it('returns null and warns when apiServer=true but no key configured', async () => {
    config.apiServer = true;
    config.komodoApiKey = undefined;
    const { logger } = await import('../utils/logger.js');
    const result = await startApiServerIfEnabled();
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('starts and returns server when apiServer=true and key is set', async () => {
    config.apiServer = true;
    config.komodoApiKey = 'test-secret';
    config.apiPort = 3099;
    const server = await startApiServerIfEnabled();
    expect(server).toBeInstanceOf(KomodoApiServer);
    await server.stop();
  });

  it('passes onRun callback to server', async () => {
    config.apiServer = true;
    config.komodoApiKey = 'test-secret';
    config.apiPort = 3100;
    const onRun = vi.fn();
    const server = await startApiServerIfEnabled({ onRun });
    expect(server._onRun).toBe(onRun);
    await server.stop();
  });

  it('passes onCreateTask callback to server', async () => {
    config.apiServer = true;
    config.komodoApiKey = 'test-secret';
    config.apiPort = 3101;
    const onCreateTask = vi.fn();
    const server = await startApiServerIfEnabled({ onCreateTask });
    expect(server._onCreateTask).toBe(onCreateTask);
    await server.stop();
  });
});
