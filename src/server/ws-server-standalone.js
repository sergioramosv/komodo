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

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB

// ── Estado interno ──────────────────────────────────────────────────────
// Replica la estructura de KomodoState para que el dashboard reciba
// exactamente el mismo formato sin importar si viene del orquestador
// o de este servidor standalone.

function createInitialState() {
  return {
    agents: {
      PLANNER: { name: 'PLANNER', status: 'idle', currentTask: null, startedAt: null, avatar: 'planner', cli: null, model: null, totalCost: 0, totalTurns: 0, completedTasks: 0 },
      CODER: { name: 'CODER', status: 'idle', currentTask: null, startedAt: null, avatar: 'coder', cli: null, model: null, totalCost: 0, totalTurns: 0, completedTasks: 0 },
      REVIEWER: { name: 'REVIEWER', status: 'idle', currentTask: null, startedAt: null, avatar: 'reviewer', cli: null, model: null, totalCost: 0, totalTurns: 0, completedTasks: 0 },
    },
    phase: 'idle',
    currentTask: null,
    taskDetails: null,
    currentPR: null,
    reviewCycle: 0,
    totalCost: 0,
    tasksCompleted: 0,
    totalTasks: 0,
    executionState: 'stopped',
  };
}

/**
 * Aplica un evento al estado interno para mantener el snapshot actualizado.
 *
 * @param {Object} state - Estado mutable
 * @param {Object} event - Evento con estructura { type, agentName, newState, metadata }
 */
function applyEvent(state, event) {
  switch (event.type) {
    case 'agent:state-change':
      if (event.agentName && state.agents[event.agentName]) {
        state.agents[event.agentName].status = event.newState || 'idle';
        if (event.metadata?.taskTitle) {
          state.agents[event.agentName].currentTask = event.metadata.taskTitle;
        } else if (event.newState === 'idle') {
          state.agents[event.agentName].currentTask = null;
        }
        if (event.metadata?.cli) state.agents[event.agentName].cli = event.metadata.cli;
        if (event.metadata?.model) state.agents[event.agentName].model = event.metadata.model;
      }
      if (event.metadata?.taskTitle) {
        state.currentTask = event.metadata.taskTitle;
        if (event.metadata.taskId) {
          state.taskDetails = {
            id: event.metadata.taskId,
            title: event.metadata.taskTitle,
            devPoints: event.metadata.devPoints || 0,
            branchName: event.metadata.branchName || null,
          };
        }
      }
      if (event.newState === 'working') {
        state.executionState = 'running';
      }
      break;

    case 'task:started':
      if (event.metadata) {
        state.currentTask = event.metadata.taskTitle || event.metadata.taskId || null;
        state.taskDetails = event.metadata.taskDetails || null;
        state.totalTasks = (state.totalTasks || 0) + 1;
        state.executionState = 'running';
      }
      break;

    case 'task:completed':
      state.tasksCompleted = (state.tasksCompleted || 0) + 1;
      state.currentTask = null;
      state.taskDetails = null;
      state.currentPR = null;
      state.reviewCycle = 0;
      state.phase = 'idle';
      break;

    case 'pr:created':
      if (event.metadata) {
        state.currentPR = event.metadata.prNumber
          ? { number: event.metadata.prNumber, repo: event.metadata.repo }
          : (event.metadata.prUrl || null);
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

    case 'execution:state-change':
      if (event.metadata?.current) {
        state.executionState = event.metadata.current;
      }
      break;
  }

  // Actualizar fase si viene en metadata
  if (event.metadata?.phase) {
    state.phase = event.metadata.phase;
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────

/**
 * Parsea el body de una petición HTTP con límite de tamaño.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let exceeded = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        exceeded = true;
        req.resume(); // drain remaining data
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (exceeded) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
      } else {
        resolve(body);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Crea un servidor standalone con HTTP + WebSocket.
 * Exportado para testing; en producción se invoca automáticamente.
 *
 * @returns {{ httpServer: import('http').Server, wss: WebSocketServer, state: Object, applyEvent: Function, shutdown: Function }}
 */
export function createStandaloneServer() {
  const state = createInitialState();

  /** @type {WebSocketServer} */
  let wss;

  /**
   * Envía un mensaje a todos los clientes WebSocket conectados.
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

        // Validar estructura del evento
        if (!event.type || typeof event.type !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'event.type must be a non-empty string' }));
          return;
        }

        applyEvent(state, event);
        broadcast({ type: 'event', data: event });
        broadcast({ type: 'snapshot', data: { ...state, agents: { ...state.agents } } });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        if (err.message === 'PAYLOAD_TOO_LARGE') {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload Too Large' }));
          return;
        }
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

  const VALID_COMMANDS = new Set(['pause', 'stop']);

  function handleCommand(command, ws) {
    switch (command) {
      case 'pause':
        console.log('[WS] Pause command received from dashboard');
        state.executionState = 'paused';
        break;
      case 'stop':
        console.log('[WS] Stop command received from dashboard');
        state.executionState = 'stopped';
        break;
    }

    // Broadcast execution state change
    const event = {
      type: 'execution:state-change',
      timestamp: new Date().toISOString(),
      agentName: null,
      previousState: null,
      newState: null,
      metadata: { previous: state.executionState === command ? null : state.executionState, current: state.executionState },
    };
    broadcast({ type: 'event', data: event });

    // Acknowledge
    try {
      ws.send(JSON.stringify({ type: 'command:ack', command }));
    } catch {
      // Ignore
    }
  }

  wss.on('connection', (ws) => {
    const total = wss.clients.size;
    console.log(`[WS] Dashboard conectado (total: ${total})`);

    // Enviar snapshot inicial
    try {
      ws.send(JSON.stringify({ type: 'snapshot', data: { ...state, agents: { ...state.agents } } }));
    } catch {
      // Ignorar si falla el envío inicial
    }

    // Handle incoming commands from dashboard
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'command' && VALID_COMMANDS.has(msg.command)) {
          handleCommand(msg.command, ws);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Dashboard desconectado (total: ${wss.clients.size})`);
    });
  });

  /**
   * Graceful shutdown: cierra WS clients y luego el HTTP server.
   */
  function shutdown() {
    return new Promise((resolve) => {
      console.log('[WS] Cerrando servidor...');
      for (const client of wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      wss.close(() => {
        httpServer.close(() => {
          console.log('[WS] Servidor cerrado.');
          resolve();
        });
      });
    });
  }

  return { httpServer, wss, state, applyEvent: (event) => applyEvent(state, event), broadcast, shutdown };
}

// ── Auto-start cuando se ejecuta directamente ──────────────────────────

const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule) {
  const PORT = parseInt(process.env.WS_PORT || '3001', 10);
  const { httpServer, shutdown } = createStandaloneServer();

  httpServer.listen(PORT, () => {
    console.log(`[WS] Servidor standalone escuchando en puerto ${PORT}`);
    console.log(`[WS] GET  http://localhost:${PORT}/api/state  → snapshot del estado`);
    console.log(`[WS] POST http://localhost:${PORT}/api/event  → enviar evento`);
    console.log(`[WS] WS   ws://localhost:${PORT}             → conexión WebSocket`);
  });

  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });
}

export { applyEvent as _applyEvent, readBody as _readBody, MAX_BODY_SIZE };
