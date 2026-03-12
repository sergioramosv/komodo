import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { eventBus } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { approvalChannelManager } from '../autonomy/approval-channels.js';

/** Valid command types from dashboard. */
const VALID_COMMANDS = new Set(['pause', 'stop', 'approve', 'reject']);

/**
 * Servidor WebSocket + HTTP para emitir estado en tiempo real al dashboard.
 *
 * - WebSocket: reenvía todos los eventos del EventBus a clientes conectados
 * - HTTP GET /api/state: devuelve snapshot del estado actual (sin WebSocket)
 * - Envía snapshot completo al conectar un nuevo cliente
 */
export class KomodoWsServer {
  /**
   * @param {Object} [options]
   * @param {number} [options.port] - Puerto del servidor (default: config.wsPort)
   */
  constructor(options = {}) {
    this.port = options.port ?? config.wsPort;

    /** @type {import('http').Server|null} */
    this._httpServer = null;

    /** @type {WebSocketServer|null} */
    this._wss = null;

    /** @type {(() => void)|null} */
    this._unsubscribe = null;
  }

  /**
   * Inicia el servidor HTTP + WebSocket y suscribe al EventBus.
   *
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this._httpServer = createServer((req, res) => this._handleHttp(req, res));

      this._wss = new WebSocketServer({ server: this._httpServer });

      this._wss.on('connection', (ws) => {
        logger.info(`Dashboard conectado (total: ${this._wss.clients.size})`, 'WS');

        // Enviar snapshot inicial
        this._send(ws, { type: 'snapshot', data: komodoState.getSnapshot() });

        // Handle incoming commands from dashboard
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'command' && VALID_COMMANDS.has(msg.command)) {
              this._handleCommand(msg.command, ws, msg);
            }
          } catch {
            // Ignore malformed messages
          }
        });

        ws.on('close', () => {
          const total = this._wss ? this._wss.clients.size : 0;
          logger.info(`Dashboard desconectado (total: ${total})`, 'WS');
        });
      });

      // Suscribirse a TODOS los eventos del EventBus → broadcast
      this._unsubscribe = eventBus.onAny((payload) => {
        this._broadcast({ type: 'event', data: payload });
      });

      this._httpServer.on('error', (err) => {
        reject(err);
      });

      this._httpServer.listen(this.port, () => {
        logger.info(`Servidor WS escuchando en puerto ${this.port}`, 'WS');
        resolve();
      });
    });
  }

  /**
   * Detiene el servidor y limpia recursos.
   *
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (this._unsubscribe) {
        this._unsubscribe();
        this._unsubscribe = null;
      }

      // Cerrar todas las conexiones WebSocket
      if (this._wss) {
        for (const client of this._wss.clients) {
          client.close(1001, 'Server shutting down');
        }
        this._wss.close();
        this._wss = null;
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
   * Handles an execution command from the dashboard.
   *
   * @param {string} command - 'pause' | 'stop' | 'approve' | 'reject'
   * @param {import('ws').WebSocket} ws - The client that sent the command
   * @param {Object} [msg] - Full message object (for approve/reject requestId)
   */
  _handleCommand(command, ws, msg = {}) {
    switch (command) {
      case 'pause':
        logger.info('Pause command received from dashboard', 'WS');
        komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
        break;
      case 'stop':
        logger.info('Stop command received from dashboard', 'WS');
        komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
        break;
      case 'approve':
        logger.info('Approve command received from dashboard', 'WS');
        approvalChannelManager.respond(true);
        break;
      case 'reject':
        logger.info('Reject command received from dashboard', 'WS');
        approvalChannelManager.respond(false);
        break;
    }

    // Acknowledge the command
    this._send(ws, { type: 'command:ack', command });
  }

  /**
   * Maneja peticiones HTTP (REST endpoint).
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  _handleHttp(req, res) {
    // CORS headers para el dashboard
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/state') {
      const snapshot = komodoState.getSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot));
      return;
    }

    // POST /api/approve — approve or reject a pending approval request
    if (req.method === 'POST' && req.url === '/api/approve') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const { requestId, approved } = JSON.parse(body);
          if (!requestId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end('{"error":"requestId required"}');
            return;
          }
          const found = approvalChannelManager.resolveApproval(requestId, !!approved);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: found }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"Invalid JSON"}');
        }
      });
      return;
    }

    // Receive forwarded events from komodo-mcp (separate process)
    if (req.method === 'POST' && req.url === '/api/event') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);

          // Handle task lifecycle events
          if (payload.type === 'task:started') {
            komodoState.totalTasks = (komodoState.totalTasks || 0) + 1;
            const taskName = payload.metadata?.taskTitle || payload.metadata?.title;
            if (taskName) {
              komodoState.currentTask = taskName;
              komodoState.taskDetails = payload.metadata.taskDetails || null;
            }
            komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
          }
          if (payload.type === 'task:completed') {
            komodoState.tasksCompleted = (komodoState.tasksCompleted || 0) + 1;
            komodoState.currentTask = null;
            komodoState.taskDetails = null;
            komodoState.currentPR = null;
            komodoState.reviewCycle = 0;
          }
          if (payload.type === 'pr:created') {
            komodoState.currentPR = payload.metadata?.prNumber
              ? { number: payload.metadata.prNumber, repo: payload.metadata.repo }
              : null;
          }
          if (payload.type === 'pr:merged') {
            komodoState.currentPR = null;
          }
          if (payload.type === 'execution:state-change') {
            const newState = payload.metadata?.current;
            if (newState) {
              komodoState.setExecutionState(newState);
            }
          }

          // Update komodoState from agent state change events
          if (payload.type === 'agent:state-change' && payload.agentName) {
            const status = payload.newState || payload.metadata?.newState;
            if (status) {
              komodoState.updateAgent(payload.agentName, {
                status,
                currentTask: payload.metadata?.taskTitle || payload.metadata?.taskId || null,
                cli: payload.metadata?.cli || null,
                model: payload.metadata?.model || null,
              });
            }
            if (payload.metadata?.phase) {
              komodoState.updatePhase(payload.metadata.phase);
              if (payload.metadata.phase !== 'idle') {
                komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
              }
            }
            // Update current task info
            if (payload.metadata?.taskTitle) {
              komodoState.currentTask = payload.metadata.taskTitle;
              komodoState.taskDetails = {
                id: payload.metadata.taskId || null,
                title: payload.metadata.taskTitle,
                devPoints: payload.metadata.devPoints || 0,
                branchName: payload.metadata.branchName || null,
              };
            }
            // Clear task when phase goes idle
            if (payload.metadata?.phase === 'idle' && payload.newState === 'idle') {
              komodoState.currentTask = null;
              komodoState.taskDetails = null;
            }
          }

          // Broadcast event + updated snapshot to all WebSocket clients
          this._broadcast({ type: 'event', data: payload });
          this._broadcast({ type: 'snapshot', data: komodoState.getSnapshot() });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"Invalid JSON"}');
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Envía un mensaje JSON a un cliente WebSocket.
   *
   * @param {import('ws').WebSocket} ws
   * @param {Object} message
   */
  _send(ws, message) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        logger.warn(`Error enviando a cliente WS: ${err.message}`, 'WS');
      }
    }
  }

  /**
   * Envía un mensaje a TODOS los clientes conectados.
   *
   * @param {Object} message
   */
  _broadcast(message) {
    if (!this._wss) return;

    const data = JSON.stringify(message);
    for (const client of this._wss.clients) {
      if (client.readyState === client.OPEN) {
        try {
          client.send(data);
        } catch (err) {
          logger.warn(`Error broadcast WS: ${err.message}`, 'WS');
        }
      }
    }
  }
}
