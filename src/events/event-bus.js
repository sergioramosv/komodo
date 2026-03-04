import { EventEmitter } from 'events';

/**
 * Tipos de eventos del orquestador.
 */
export const EVENT_TYPES = {
  AGENT_STATE_CHANGE: 'agent:state-change',
  AGENT_OUTPUT: 'agent:output',
  TASK_STARTED: 'task:started',
  TASK_COMPLETED: 'task:completed',
  REVIEW_CYCLE: 'review:cycle',
  REVIEW_CYCLE_START: 'review:cycle:start',
  REVIEW_CYCLE_END: 'review:cycle:end',
  PR_CREATED: 'pr:created',
  PR_MERGED: 'pr:merged',
  COST_UPDATED: 'cost:updated',
  BROWSER_CHECK: 'browser:check',

  // SonarQube analysis events
  SONAR_ANALYSIS_START: 'sonar:analysis:start',
  SONAR_ANALYSIS_COMPLETE: 'sonar:analysis:complete',
  SONAR_ANALYSIS_ERROR: 'sonar:analysis:error',

  // Rate limit detection
  RATE_LIMIT_DETECTED: 'agent:rate-limit',

  // Agent fallback on rate limit
  AGENT_FALLBACK: 'agent:fallback',

  // Checkpoint persistence
  SESSION_CHECKPOINTED: 'session:checkpointed',

  // Heartbeat monitor
  CLI_RECOVERED: 'cli:recovered',

  // Triage / complexity classification
  TASK_CLASSIFIED: 'task:classified',
  TASK_DECOMPOSED: 'task:decomposed',
  MODEL_SELECTED: 'triage:model-selected',

  // Execution control events
  EXECUTION_STATE_CHANGE: 'execution:state-change',

  // Agent-specific convenience events
  AGENT_PLANNER_WORKING: 'agent:planner:working',
  AGENT_PLANNER_DONE: 'agent:planner:done',
  AGENT_PLANNER_IDLE: 'agent:planner:idle',
  AGENT_CODER_WORKING: 'agent:coder:working',
  AGENT_CODER_DONE: 'agent:coder:done',
  AGENT_CODER_IDLE: 'agent:coder:idle',
  AGENT_REVIEWER_WORKING: 'agent:reviewer:working',
  AGENT_REVIEWER_DONE: 'agent:reviewer:done',
  AGENT_REVIEWER_IDLE: 'agent:reviewer:idle',
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
export class KomodoEventBus extends EventEmitter {
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
      } catch (err) {
        console.warn('EventBus: onAny listener error', err);
      }
    }

    return payload;
  }

  /**
   * Emite un evento específico de agente (agent:X:state).
   *
   * Emite tanto el evento específico (agent:planner:working) como el genérico
   * (agent:state-change) para mantener compatibilidad.
   *
   * @param {string} agentName - PLANNER, CODER o REVIEWER
   * @param {'working'|'done'|'idle'} state - Estado del agente
   * @param {Object} [metadata] - Datos adicionales
   * @returns {Object} El payload emitido
   */
  emitAgentEvent(agentName, state, metadata = {}) {
    const eventName = `agent:${agentName.toLowerCase()}:${state}`;
    return this.emitEvent(eventName, { agentName, metadata });
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

  /**
   * Elimina todos los listeners, incluyendo los de onAny.
   */
  removeAllListeners(eventName) {
    super.removeAllListeners(eventName);
    if (!eventName) {
      this._anyListeners = [];
    }
    return this;
  }
}

/** Instancia singleton del EventBus. */
export const eventBus = new KomodoEventBus();
