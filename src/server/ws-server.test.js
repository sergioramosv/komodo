import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KomodoWsServer } from './ws-server.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';
import WebSocket from 'ws';

/**
 * Helper: conecta un cliente WS y colecciona mensajes desde el inicio.
 * Retorna { ws, messages, waitFor(n) }.
 */
function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const messages = [];
    let waitResolve = null;
    let waitTarget = 0;

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
      if (waitResolve && messages.length >= waitTarget) {
        waitResolve();
        waitResolve = null;
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        /** Espera hasta tener al menos n mensajes. */
        waitFor(n) {
          if (messages.length >= n) return Promise.resolve();
          waitTarget = n;
          return new Promise((res) => { waitResolve = res; });
        },
      });
    });

    ws.on('error', reject);
  });
}

describe('KomodoWsServer', () => {
  let server;
  const TEST_PORT = 9871;

  beforeEach(() => {
    server = new KomodoWsServer({ port: TEST_PORT });
  });

  afterEach(async () => {
    await server.stop();
  });

  // ── start/stop ──────────────────────────────────────

  describe('start/stop', () => {
    it('inicia en el puerto configurado', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/api/state`);
      expect(res.status).toBe(200);
    });

    it('puede pararse y liberar el puerto', async () => {
      await server.start();
      await server.stop();

      // Debería poder reutilizar el puerto
      const server2 = new KomodoWsServer({ port: TEST_PORT });
      await server2.start();
      await server2.stop();
    });

    it('stop sin start no lanza error', async () => {
      await expect(server.stop()).resolves.not.toThrow();
    });
  });

  // ── REST /api/state ─────────────────────────────────

  describe('GET /api/state', () => {
    it('devuelve snapshot del estado actual', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/api/state`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('agents');
      expect(body).toHaveProperty('phase');
      expect(body.agents).toHaveProperty('PLANNER');
      expect(body.agents).toHaveProperty('CODER');
      expect(body.agents).toHaveProperty('REVIEWER');
    });

    it('incluye CORS headers', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/api/state`);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('devuelve 404 para rutas desconocidas', async () => {
      await server.start();

      const res = await fetch(`http://localhost:${TEST_PORT}/unknown`);
      expect(res.status).toBe(404);
    });
  });

  // ── WebSocket snapshot ──────────────────────────────

  describe('WebSocket snapshot', () => {
    it('envía snapshot al conectar', async () => {
      await server.start();

      const client = await connectClient(TEST_PORT);
      await client.waitFor(1);

      const msg = client.messages[0];
      expect(msg.type).toBe('snapshot');
      expect(msg.data).toHaveProperty('agents');
      expect(msg.data).toHaveProperty('phase');

      client.ws.close();
    });
  });

  // ── WebSocket broadcast ─────────────────────────────

  describe('WebSocket broadcast', () => {
    it('reenvía eventos del EventBus a clientes conectados', async () => {
      await server.start();

      const client = await connectClient(TEST_PORT);
      await client.waitFor(1); // snapshot

      eventBus.emitEvent(EVENT_TYPES.TASK_STARTED, {
        metadata: { taskId: 'test-123' },
      });

      await client.waitFor(2); // snapshot + event

      const msg = client.messages[1];
      expect(msg.type).toBe('event');
      expect(msg.data.type).toBe(EVENT_TYPES.TASK_STARTED);
      expect(msg.data.metadata.taskId).toBe('test-123');

      client.ws.close();
    });

    it('envía a múltiples clientes', async () => {
      await server.start();

      const c1 = await connectClient(TEST_PORT);
      const c2 = await connectClient(TEST_PORT);
      await c1.waitFor(1);
      await c2.waitFor(1);

      eventBus.emitEvent(EVENT_TYPES.PR_CREATED, {
        metadata: { prNumber: 42 },
      });

      await c1.waitFor(2);
      await c2.waitFor(2);

      expect(c1.messages[1].data.type).toBe(EVENT_TYPES.PR_CREATED);
      expect(c2.messages[1].data.type).toBe(EVENT_TYPES.PR_CREATED);

      c1.ws.close();
      c2.ws.close();
    });
  });

  // ── cleanup ─────────────────────────────────────────

  describe('cleanup', () => {
    it('deja de reenviar eventos después de stop', async () => {
      await server.start();

      const client = await connectClient(TEST_PORT);
      await client.waitFor(1);

      await server.stop();

      // Emitir después de stop no debería causar error
      expect(() => {
        eventBus.emitEvent(EVENT_TYPES.TASK_STARTED);
      }).not.toThrow();
    });
  });
});
