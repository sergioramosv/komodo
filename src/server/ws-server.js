import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { eventBus } from '../events/event-bus.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/** Valid command types from dashboard. */
const VALID_COMMANDS = new Set(['pause', 'stop']);

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
              this._handleCommand(msg.command, ws);
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
   * @param {string} command - 'pause' | 'stop'
   * @param {import('ws').WebSocket} ws - The client that sent the command
   */
  _handleCommand(command, ws) {
    switch (command) {
      case 'pause':
        logger.info('Pause command received from dashboard', 'WS');
        komodoState.setExecutionState(EXECUTION_STATES.PAUSED);
        break;
      case 'stop':
        logger.info('Stop command received from dashboard', 'WS');
        komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
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
