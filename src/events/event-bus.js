import { EventEmitter } from 'node:events';

/**
 * Tipos de eventos soportados por el EventBus de Komodo.
 *
 * @typedef {'agent:state-change' | 'task:started' | 'task:completed' | 'review:cycle' | 'pr:created' | 'pr:merged' | 'cost:updated'} KomodoEventType
 */

/**
 * @typedef {Object} KomodoEvent
 * @property {KomodoEventType} type - Tipo del evento
 * @property {string} timestamp - ISO timestamp
 * @property {string} [agentName] - Nombre del agente (PLANNER, CODER, REVIEWER, KOMODO)
 * @property {string} [previousState] - Estado anterior (para state-change)
 * @property {string} [newState] - Nuevo estado (para state-change)
 * @property {Object} [metadata] - Datos adicionales del evento
 */

/** Todos los tipos de eventos válidos */
const EVENT_TYPES = [
  'agent:state-change',
  'task:started',
  'task:completed',
  'review:cycle',
  'pr:created',
  'pr:merged',
  'cost:updated',
];

/** Estados válidos de los agentes — evitar strings hardcodeados */
export const AGENT_STATES = Object.freeze({
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
});

/**
 * EventBus interno del orquestador Komodo.
 *
 * Extiende EventEmitter de Node.js y agrega:
 * - Eventos tipados con validación
 * - Payload estandarizado (timestamp, agentName, metadata)
 * - Método onAny() para escuchar todos los eventos (logging, dashboard)
 * - Singleton exportado para uso global
 */
class KomodoEventBus extends EventEmitter {
  constructor() {
    super();
    /** @type {Function[]} — listeners registrados con onAny() */
    this._anyListeners = [];
  }

  /**
   * Emite un evento tipado con payload estandarizado.
   *
   * @param {KomodoEventType} type - Tipo de evento
   * @param {Object} [payload={}] - Datos del evento
   * @param {string} [payload.agentName] - Nombre del agente
   * @param {string} [payload.previousState] - Estado anterior
   * @param {string} [payload.newState] - Nuevo estado
   * @param {Object} [payload.metadata] - Datos adicionales
   * @returns {boolean} true si el evento tuvo listeners
   */
  emitEvent(type, payload = {}) {
    if (!EVENT_TYPES.includes(type)) {
      throw new Error(`Evento desconocido: "${type}". Válidos: ${EVENT_TYPES.join(', ')}`);
    }

    const event = {
      type,
      timestamp: new Date().toISOString(),
      agentName: payload.agentName || null,
      previousState: payload.previousState || null,
      newState: payload.newState || null,
      metadata: payload.metadata || {},
    };

    // Notificar a listeners de onAny()
    for (const fn of this._anyListeners) {
      try {
        fn(event);
      } catch (err) {
        // No romper el flujo por un listener fallido, pero loggear el error
        console.error(`[EventBus] Error en listener onAny() al procesar "${type}": ${err.message}`);
      }
    }

    return super.emit(type, event);
  }

  /**
   * Suscribirse a un tipo de evento específico.
   *
   * @param {KomodoEventType} type - Tipo de evento
   * @param {Function} listener - Callback que recibe el KomodoEvent
   * @returns {this}
   */
  subscribe(type, listener) {
    return this.on(type, listener);
  }

  /**
   * Suscribirse a TODOS los eventos (útil para logging y dashboards).
   *
   * @param {Function} listener - Callback que recibe el KomodoEvent
   * @returns {Function} Función para desuscribirse
   */
  onAny(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('onAny() requiere una función como argumento');
    }

    this._anyListeners.push(listener);

    // Devolver función de cleanup
    return () => {
      this._anyListeners = this._anyListeners.filter(fn => fn !== listener);
    };
  }

  /**
   * Elimina todos los listeners (incluidos los de onAny).
   */
  removeAllListeners(type) {
    this._anyListeners = [];
    return super.removeAllListeners(type);
  }

  /**
   * Lista de tipos de eventos válidos.
   * @returns {string[]}
   */
  get eventTypes() {
    return [...EVENT_TYPES];
  }
}

/** Singleton — una sola instancia para toda la app */
export const eventBus = new KomodoEventBus();
