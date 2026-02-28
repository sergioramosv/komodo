import { EventEmitter } from 'events';

/**
 * Tipos de eventos del orquestador.
 */
export const EVENT_TYPES = {
  AGENT_STATE_CHANGE: 'agent:state-change',
  TASK_STARTED: 'task:started',
  TASK_COMPLETED: 'task:completed',
  REVIEW_CYCLE: 'review:cycle',
  PR_CREATED: 'pr:created',
  PR_MERGED: 'pr:merged',
  COST_UPDATED: 'cost:updated',
};

/**
 * Estados posibles de un agente.
 */
export const AGENT_STATES = {
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
};

/**
 * EventBus interno del orquestador Komodo.
 *
 * Emite eventos tipados con payload estandar para que cualquier cliente
 * (dashboard, CLI, logs) pueda suscribirse y mostrar estado en tiempo real.
 */
class KomodoEventBus extends EventEmitter {
  constructor() {
    super();
    /** @type {Array<(payload: object) => void>} */
    this._anyListeners = [];
  }

  /**
   * Emite un evento tipado con payload estandar.
   *
   * @param {string} eventType - Tipo de evento (usar EVENT_TYPES)
   * @param {Object} [data]
   * @param {string} [data.agentName] - Nombre del agente (PLANNER, CODER, REVIEWER)
   * @param {string} [data.previousState] - Estado anterior
   * @param {string} [data.newState] - Nuevo estado
   * @param {Object} [data.metadata] - Datos adicionales del evento
   * @returns {Object} El payload emitido
   */
  emitEvent(eventType, { agentName, previousState, newState, metadata = {} } = {}) {
    const payload = {
      type: eventType,
      timestamp: new Date().toISOString(),
      agentName: agentName || null,
      previousState: previousState || null,
      newState: newState || null,
      metadata,
    };

    this.emit(eventType, payload);

    for (const listener of this._anyListeners) {
      try {
        listener(payload);
      } catch {
        // Never let a listener crash the orchestrator
      }
    }

    return payload;
  }

  /**
   * Suscribirse a TODOS los eventos (para logging, dashboard, etc.).
   *
   * @param {(payload: object) => void} listener
   * @returns {() => void} Funcion para desuscribirse
   */
  onAny(listener) {
    this._anyListeners.push(listener);
    return () => {
      this._anyListeners = this._anyListeners.filter(l => l !== listener);
    };
  }
}

/** Instancia singleton del EventBus. */
export const eventBus = new KomodoEventBus();
