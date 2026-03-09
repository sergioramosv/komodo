import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    apiServerEnabled: true,
    apiServerPort: 0, // 0 = OS picks a free port
    komodoApiKey: 'test-api-key-123',
    apiRateLimitMax: 60,
    defaultProjectId: 'proj-test',
    defaultUserId: 'user-1',
    defaultUserName: 'Test User',
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../skills/planning-task-mcp/src/firebase.js', () => ({
  create: vi.fn(),
}));

import { config } from '../config.js';
import { create } from '../../skills/planning-task-mcp/src/firebase.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { KomodoApiServer, isRateLimited, validateApiKey } from './api-server.js';

/** @type {KomodoApiServer} */
let server;
/** @type {string} */
let baseUrl;

/**
 * Helper to make requests to the test server.
 */
async function request(method, path, { body, headers = {} } = {}) {
  const opts = {
    method,
    headers: {
      'X-Komodo-Key': 'test-api-key-123',
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

beforeEach(async () => {
  vi.clearAllMocks();
  config.komodoApiKey = 'test-api-key-123';
  config.apiRateLimitMax = 60;
  config.defaultProjectId = 'proj-test';

  // Reset komodoState
  komodoState.setExecutionState(EXECUTION_STATES.STOPPED);

  server = new KomodoApiServer({ port: 0 });
  await server.start();

  const addr = server._server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await server.stop();
});

// ── Authentication ──

describe('Authentication', () => {
  it('rejects requests without API key', async () => {
    const res = await fetch(`${baseUrl}/api/status`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toMatch(/Invalid or missing API key/);
  });

  it('rejects requests with wrong API key', async () => {
    const { status, data } = await request('GET', '/api/status', {
      headers: { 'X-Komodo-Key': 'wrong-key' },
    });
    expect(status).toBe(401);
    expect(data.error).toMatch(/Invalid or missing API key/);
  });

  it('accepts requests with correct API key', async () => {
    const { status } = await request('GET', '/api/status');
    expect(status).toBe(200);
  });
});

// ── CORS ──

describe('CORS', () => {
  it('responds to OPTIONS with 204', async () => {
    const res = await fetch(`${baseUrl}/api/status`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')).toContain('X-Komodo-Key');
  });
});

// ── GET /api/status ──

describe('GET /api/status', () => {
  it('returns current Komodo status', async () => {
    const { status, data } = await request('GET', '/api/status');
    expect(status).toBe(200);
    expect(data).toHaveProperty('executionState');
    expect(data).toHaveProperty('phase');
    expect(data).toHaveProperty('agents');
    expect(data.agents).toHaveProperty('PLANNER');
    expect(data.agents).toHaveProperty('CODER');
    expect(data.agents).toHaveProperty('QA');
    expect(data.agents).toHaveProperty('REVIEWER');
  });

  it('reflects execution state changes', async () => {
    komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
    const { data } = await request('GET', '/api/status');
    expect(data.executionState).toBe('running');
  });
});

// ── POST /api/run ──

describe('POST /api/run', () => {
  it('sets execution state to running', async () => {
    const { status, data } = await request('POST', '/api/run', {
      body: { tasks: 2 },
    });
    expect(status).toBe(202);
    expect(data.tasks).toBe(2);
    expect(data.executionState).toBe('running');
    expect(komodoState.executionState).toBe(EXECUTION_STATES.RUNNING);
  });

  it('defaults to 1 task', async () => {
    const { data } = await request('POST', '/api/run', { body: {} });
    expect(data.tasks).toBe(1);
  });

  it('rejects negative task count', async () => {
    const { status, data } = await request('POST', '/api/run', {
      body: { tasks: -1 },
    });
    expect(status).toBe(400);
    expect(data.error).toMatch(/non-negative/);
  });

  it('requires projectId when not configured', async () => {
    config.defaultProjectId = '';
    const { status, data } = await request('POST', '/api/run', { body: {} });
    expect(status).toBe(400);
    expect(data.error).toMatch(/projectId/);
  });
});

// ── POST /api/stop ──

describe('POST /api/stop', () => {
  it('sets execution state to stopped', async () => {
    komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
    const { status, data } = await request('POST', '/api/stop');
    expect(status).toBe(200);
    expect(data.executionState).toBe('stopped');
    expect(komodoState.executionState).toBe(EXECUTION_STATES.STOPPED);
  });
});

// ── POST /api/pause ──

describe('POST /api/pause', () => {
  it('sets execution state to paused', async () => {
    komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
    const { status, data } = await request('POST', '/api/pause');
    expect(status).toBe(200);
    expect(data.executionState).toBe('paused');
    expect(komodoState.executionState).toBe(EXECUTION_STATES.PAUSED);
  });
});

// ── POST /api/task ──

describe('POST /api/task', () => {
  it('creates a task with title and defaults', async () => {
    create.mockResolvedValue('task-new-1');
    const { status, data } = await request('POST', '/api/task', {
      body: { title: 'Fix login bug' },
    });
    expect(status).toBe(201);
    expect(data.taskId).toBe('task-new-1');
    expect(data.title).toBe('Fix login bug');
    expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
      title: 'Fix login bug',
      status: 'to-do',
      source: 'api',
      devPoints: 3,
      bizPoints: 5,
    }));
  });

  it('accepts custom devPoints and bizPoints', async () => {
    create.mockResolvedValue('task-new-2');
    await request('POST', '/api/task', {
      body: { title: 'Big feature', devPoints: 8, bizPoints: 13 },
    });
    expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
      devPoints: 8,
      bizPoints: 13,
    }));
  });

  it('accepts userStory', async () => {
    create.mockResolvedValue('task-new-3');
    await request('POST', '/api/task', {
      body: { title: 'My task', userStory: 'As a user I want...' },
    });
    expect(create).toHaveBeenCalledWith('tasks', expect.objectContaining({
      userStory: 'As a user I want...',
    }));
  });

  it('rejects missing title', async () => {
    const { status, data } = await request('POST', '/api/task', { body: {} });
    expect(status).toBe(400);
    expect(data.error).toMatch(/title/);
  });

  it('returns 500 when Firebase fails', async () => {
    create.mockRejectedValue(new Error('Firebase down'));
    const { status, data } = await request('POST', '/api/task', {
      body: { title: 'Some task' },
    });
    expect(status).toBe(500);
    expect(data.error).toMatch(/Failed to create task/);
  });
});

// ── 404 ──

describe('Unknown routes', () => {
  it('returns 404 for unknown paths', async () => {
    const { status, data } = await request('GET', '/api/unknown');
    expect(status).toBe(404);
    expect(data.error).toBe('Not found');
  });

  it('returns 404 for wrong method on valid path', async () => {
    const { status } = await request('DELETE', '/api/status');
    expect(status).toBe(404);
  });
});

// ── Rate limiting ──

describe('Rate limiting', () => {
  it('isRateLimited returns false under limit', () => {
    const result = isRateLimited('test-ip-1');
    expect(result).toBe(false);
  });

  it('isRateLimited returns true when limit exceeded', () => {
    config.apiRateLimitMax = 3;
    // Use a unique IP to avoid interference from other tests
    const ip = `rate-limit-test-${Date.now()}`;
    isRateLimited(ip); // 1
    isRateLimited(ip); // 2
    isRateLimited(ip); // 3
    const result = isRateLimited(ip); // 4 → should be limited
    expect(result).toBe(true);
  });

  it('returns 429 when rate limit exceeded', async () => {
    config.apiRateLimitMax = 2;

    // Make requests until rate limited
    await request('GET', '/api/status');
    await request('GET', '/api/status');
    const { status, data } = await request('GET', '/api/status');
    expect(status).toBe(429);
    expect(data.error).toMatch(/Rate limit/);
  });
});

// ── validateApiKey helper ──

describe('validateApiKey', () => {
  it('returns true for correct key', () => {
    const fakeReq = { headers: { 'x-komodo-key': 'test-api-key-123' } };
    expect(validateApiKey(fakeReq)).toBe(true);
  });

  it('returns false for missing key', () => {
    const fakeReq = { headers: {} };
    expect(validateApiKey(fakeReq)).toBe(false);
  });

  it('returns false for wrong key', () => {
    const fakeReq = { headers: { 'x-komodo-key': 'wrong' } };
    expect(validateApiKey(fakeReq)).toBe(false);
  });
});

// ── Server lifecycle ──

describe('KomodoApiServer lifecycle', () => {
  it('does not start without API key', async () => {
    const noKeyServer = new KomodoApiServer({ apiKey: '' });
    await noKeyServer.start();
    expect(noKeyServer._server).toBeNull();
  });

  it('can stop a server that was never started', async () => {
    const srv = new KomodoApiServer();
    await srv.stop(); // should not throw
  });
});
