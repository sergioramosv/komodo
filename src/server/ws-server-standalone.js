#!/usr/bin/env node

/**
 * Servidor WebSocket standalone para modo MCP.
 *
 * Corre como proceso independiente del orquestador. Los MCP tools envían
 * eventos via HTTP POST /api/event y este servidor los retransmite por
 * WebSocket a los dashboards conectados.
 *
 * Endpoints:
 *   GET  /api/state  → snapshot del estado actual (JSON)
 *   POST /api/event  → recibe un evento y lo broadcast a clientes WS
 *   WS   ws://host:port → conexión WebSocket (envía snapshot al conectar)
 *
 * Uso:
 *   npm run ws-server
 *   WS_PORT=4000 npm run ws-server
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.WS_PORT || '3001', 10);

// ── Estado interno ──────────────────────────────────────────────────────
// Replica la estructura de KomodoState para que el dashboard reciba
// exactamente el mismo formato sin importar si viene del orquestador
// o de este servidor standalone.

const state = {
  agents: {
    PLANNER: { name: 'PLANNER', status: 'idle', currentTask: null, startedAt: null, avatar: 'planner' },
    CODER: { name: 'CODER', status: 'idle', currentTask: null, startedAt: null, avatar: 'coder' },
    REVIEWER: { name: 'REVIEWER', status: 'idle', currentTask: null, startedAt: null, avatar: 'reviewer' },
  },
  phase: 'idle',
  currentTask: null,
  taskDetails: null,
  currentPR: null,
  reviewCycle: 0,
  totalCost: 0,
  tasksCompleted: 0,
  totalTasks: 0,
};

/**
 * Aplica un evento al estado interno para mantener el snapshot actualizado.
 *
 * @param {Object} event - Evento con estructura { type, agentName, newState, metadata }
 */
function applyEvent(event) {
  switch (event.type) {
    case 'agent:state-change':
      if (event.agentName && state.agents[event.agentName]) {
        state.agents[event.agentName].status = event.newState || 'idle';
      }
      break;

    case 'task:started':
      if (event.metadata) {
        state.currentTask = event.metadata.taskId || null;
        state.taskDetails = event.metadata.taskDetails || null;
      }
      break;

    case 'task:completed':
      state.currentTask = null;
      state.taskDetails = null;
      state.currentPR = null;
      state.phase = 'idle';
      if (event.metadata?.tasksCompleted !== undefined) {
        state.tasksCompleted = event.metadata.tasksCompleted;
      }
      break;

    case 'pr:created':
      if (event.metadata) {
        state.currentPR = event.metadata.prUrl || event.metadata.prNumber || null;
      }
      break;

    case 'pr:merged':
      state.currentPR = null;
      break;

    case 'cost:updated':
      if (event.metadata?.totalCost !== undefined) {
        state.totalCost = event.metadata.totalCost;
      }
      break;

    case 'review:cycle:start':
    case 'review:cycle:end':
      if (event.metadata?.cycle !== undefined) {
        state.reviewCycle = event.metadata.cycle;
      }
      break;
  }

  // Actualizar fase si viene en metadata
  if (event.metadata?.phase) {
    state.phase = event.metadata.phase;
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────

/** @type {WebSocketServer} */
let wss;

/**
 * Parsea el body de una petición HTTP.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Envía un mensaje a todos los clientes WebSocket conectados.
 *
 * @param {Object} message
 */
function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      try {
        client.send(data);
      } catch {
        // Cliente desconectado, ignorar
      }
    }
  }
}

const httpServer = createServer(async (req, res) => {
  // CORS para el dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/state → snapshot del estado actual
  if (req.method === 'GET' && req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  // POST /api/event → recibir evento y broadcast
  if (req.method === 'POST' && req.url === '/api/event') {
    try {
      const body = await readBody(req);
      const event = JSON.parse(body);

      applyEvent(event);
      broadcast({ type: 'event', data: event });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ── WebSocket Server ────────────────────────────────────────────────────

wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const total = wss.clients.size;
  console.log(`[WS] Dashboard conectado (total: ${total})`);

  // Enviar snapshot inicial
  try {
    ws.send(JSON.stringify({ type: 'snapshot', data: { ...state, agents: { ...state.agents } } }));
  } catch {
    // Ignorar si falla el envío inicial
  }

  ws.on('close', () => {
    console.log(`[WS] Dashboard desconectado (total: ${wss.clients.size})`);
  });
});

// ── Start ───────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[WS] Servidor standalone escuchando en puerto ${PORT}`);
  console.log(`[WS] GET  http://localhost:${PORT}/api/state  → snapshot del estado`);
  console.log(`[WS] POST http://localhost:${PORT}/api/event  → enviar evento`);
  console.log(`[WS] WS   ws://localhost:${PORT}             → conexión WebSocket`);
});
