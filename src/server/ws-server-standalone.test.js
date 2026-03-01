import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStandaloneServer, MAX_BODY_SIZE } from './ws-server-standalone.js';
import WebSocket from 'ws';

/**
 * Helper: inicia el servidor en un puerto y retorna utilidades.
 */
async function startServer(port) {
  const server = createStandaloneServer();
  await new Promise((resolve) => server.httpServer.listen(port, resolve));
  return server;
}

/**
 * Helper: conecta un cliente WS y colecciona mensajes.
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

const BASE = 'http://localhost';

describe('ws-server-standalone', () => {
  let server;
  const PORT = 9872;

  beforeEach(async () => {
    server = await startServer(PORT);
  });

  afterEach(async () => {
    await server.shutdown();
  });

  // ── POST /api/event ──────────────────────────────────

  describe('POST /api/event', () => {
    it('acepta un evento válido y responde 200', async () => {
      const res = await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'task:started', metadata: { taskId: 'T-1' } }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('rechaza JSON inválido con 400', async () => {
      const res = await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid JSON');
    });

    it('rechaza evento sin type con 400', async () => {
      const res = await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: {} }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('event.type');
    });

    it('rechaza evento con type vacío con 400', async () => {
      const res = await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: '' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('event.type');
    });

    it('rechaza evento con type no-string con 400', async () => {
      const res = await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 123 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('event.type');
    });

    it('rechaza payload mayor a MAX_BODY_SIZE con 413', async () => {
      const bigBody = JSON.stringify({ type: 'test', data: 'x'.repeat(MAX_BODY_SIZE) });

      const res = await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bigBody,
      });

      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toContain('Payload Too Large');
    });
  });

  // ── GET /api/state ───────────────────────────────────

  describe('GET /api/state', () => {
    it('devuelve el estado inicial con 200', async () => {
      const res = await fetch(`${BASE}:${PORT}/api/state`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveProperty('agents');
      expect(body).toHaveProperty('phase', 'idle');
      expect(body.agents).toHaveProperty('PLANNER');
      expect(body.agents).toHaveProperty('CODER');
      expect(body.agents).toHaveProperty('REVIEWER');
    });

    it('refleja cambios tras recibir eventos', async () => {
      await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'task:started', metadata: { taskId: 'T-42', phase: 'coding' } }),
      });

      const res = await fetch(`${BASE}:${PORT}/api/state`);
      const body = await res.json();

      expect(body.currentTask).toBe('T-42');
      expect(body.phase).toBe('coding');
    });
  });

  // ── applyEvent() por tipo ────────────────────────────

  describe('applyEvent()', () => {
    it('agent:state-change actualiza status del agente', () => {
      server.applyEvent({ type: 'agent:state-change', agentName: 'PLANNER', newState: 'working' });
      expect(server.state.agents.PLANNER.status).toBe('working');
    });

    it('task:started establece currentTask y taskDetails', () => {
      server.applyEvent({ type: 'task:started', metadata: { taskId: 'T-1', taskDetails: 'do stuff' } });
      expect(server.state.currentTask).toBe('T-1');
      expect(server.state.taskDetails).toBe('do stuff');
    });

    it('task:completed limpia estado de tarea', () => {
      server.applyEvent({ type: 'task:started', metadata: { taskId: 'T-1' } });
      server.applyEvent({ type: 'task:completed', metadata: { tasksCompleted: 5 } });
      expect(server.state.currentTask).toBeNull();
      expect(server.state.phase).toBe('idle');
      expect(server.state.tasksCompleted).toBe(5);
    });

    it('pr:created establece currentPR', () => {
      server.applyEvent({ type: 'pr:created', metadata: { prNumber: 42 } });
      expect(server.state.currentPR).toBe(42);
    });

    it('pr:merged limpia currentPR', () => {
      server.applyEvent({ type: 'pr:created', metadata: { prNumber: 42 } });
      server.applyEvent({ type: 'pr:merged' });
      expect(server.state.currentPR).toBeNull();
    });

    it('cost:updated establece totalCost', () => {
      server.applyEvent({ type: 'cost:updated', metadata: { totalCost: 1.5 } });
      expect(server.state.totalCost).toBe(1.5);
    });

    it('review:cycle:start actualiza reviewCycle', () => {
      server.applyEvent({ type: 'review:cycle:start', metadata: { cycle: 3 } });
      expect(server.state.reviewCycle).toBe(3);
    });

    it('metadata.phase actualiza la fase', () => {
      server.applyEvent({ type: 'task:started', metadata: { taskId: 'T-1', phase: 'planning' } });
      expect(server.state.phase).toBe('planning');
    });
  });

  // ── Broadcast a clientes WS ──────────────────────────

  describe('WebSocket broadcast', () => {
    it('envía eventos a clientes conectados', async () => {
      const client = await connectClient(PORT);
      await client.waitFor(1); // snapshot

      await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'task:started', metadata: { taskId: 'T-1' } }),
      });

      await client.waitFor(2); // snapshot + event

      const msg = client.messages[1];
      expect(msg.type).toBe('event');
      expect(msg.data.type).toBe('task:started');
      expect(msg.data.metadata.taskId).toBe('T-1');

      client.ws.close();
    });

    it('envía a múltiples clientes', async () => {
      const c1 = await connectClient(PORT);
      const c2 = await connectClient(PORT);
      await c1.waitFor(1);
      await c2.waitFor(1);

      await fetch(`${BASE}:${PORT}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'pr:created', metadata: { prNumber: 7 } }),
      });

      await c1.waitFor(2);
      await c2.waitFor(2);

      expect(c1.messages[1].data.type).toBe('pr:created');
      expect(c2.messages[1].data.type).toBe('pr:created');

      c1.ws.close();
      c2.ws.close();
    });
  });

  // ── Snapshot al conectar ──────────────────────────────

  describe('WebSocket snapshot', () => {
    it('envía snapshot del estado al conectar', async () => {
      const client = await connectClient(PORT);
      await client.waitFor(1);

      const msg = client.messages[0];
      expect(msg.type).toBe('snapshot');
      expect(msg.data).toHaveProperty('agents');
      expect(msg.data).toHaveProperty('phase');
      expect(msg.data.agents).toHaveProperty('PLANNER');

      client.ws.close();
    });

    it('snapshot refleja estado actual tras eventos', async () => {
      // Modificar estado antes de conectar
      server.applyEvent({ type: 'task:started', metadata: { taskId: 'T-99', phase: 'reviewing' } });

      const client = await connectClient(PORT);
      await client.waitFor(1);

      expect(client.messages[0].data.currentTask).toBe('T-99');
      expect(client.messages[0].data.phase).toBe('reviewing');

      client.ws.close();
    });
  });

  // ── Rutas desconocidas ────────────────────────────────

  describe('rutas desconocidas', () => {
    it('devuelve 404 para GET a ruta inexistente', async () => {
      const res = await fetch(`${BASE}:${PORT}/unknown`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not found');
    });

    it('devuelve 404 para POST a ruta inexistente', async () => {
      const res = await fetch(`${BASE}:${PORT}/api/other`, {
        method: 'POST',
        body: '{}',
      });
      expect(res.status).toBe(404);
    });
  });
});
