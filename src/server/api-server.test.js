import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: { apiServer: false, apiPort: 3099, komodoApiKey: 'test-secret' },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { config } = await import('../config.js');
const { KomodoApiServer, startApiServerIfEnabled } = await import('./api-server.js');

// --- helpers ---

function makeReqRes(headers = {}, method = 'GET') {
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(status) { this._status = status; },
    end(body) { this._body = body ?? null; },
  };
  const req = { method, headers };
  return { req, res };
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
});
