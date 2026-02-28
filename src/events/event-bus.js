import { EventEmitter } from 'node:events';

// ─── Event types ─────────────────────────────────────────
export const EventTypes = {
  AGENT_STATE_CHANGE: 'agent:state-change',
  TASK_STARTED: 'task:started',
  TASK_COMPLETED: 'task:completed',
  REVIEW_CYCLE: 'review:cycle',
  PR_CREATED: 'pr:created',
  PR_MERGED: 'pr:merged',
  COST_UPDATED: 'cost:updated',
};

// ─── Agent states ────────────────────────────────────────
export const AgentStates = {
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
};

// ─── EventBus ────────────────────────────────────────────

class KomodoEventBus extends EventEmitter {
  /** @type {Map<string, string>} agentName → current state */
  #agentStates = new Map();

  /**
   * Emit a typed event with standard envelope (timestamp + metadata).
   *
   * @param {string} eventType - One of EventTypes.*
   * @param {Object} payload   - Event-specific data
   */
  emitEvent(eventType, payload = {}) {
    const envelope = {
      type: eventType,
      timestamp: new Date().toISOString(),
      ...payload,
    };

    this.emit(eventType, envelope);
    this.emit('*', envelope); // wildcard channel for onAny
  }

  /**
   * Change an agent's state and emit agent:state-change.
   *
   * @param {string} agentName    - e.g. 'PLANNER', 'CODER', 'REVIEWER'
   * @param {string} newState     - One of AgentStates.*
   * @param {Object} [metadata]   - Extra context
   */
  agentStateChange(agentName, newState, metadata = {}) {
    const previousState = this.#agentStates.get(agentName) || AgentStates.IDLE;

    if (previousState === newState) return; // no-op if unchanged

    this.#agentStates.set(agentName, newState);

    this.emitEvent(EventTypes.AGENT_STATE_CHANGE, {
      agentName,
      previousState,
      newState,
      metadata,
    });
  }

  /**
   * Subscribe to ALL events (wildcard listener).
   * Useful for logging / dashboard feeds.
   *
   * @param {(event: Object) => void} listener
   * @returns {() => void} unsubscribe function
   */
  onAny(listener) {
    this.on('*', listener);
    return () => this.off('*', listener);
  }

  /**
   * Get the current state of an agent.
   *
   * @param {string} agentName
   * @returns {string}
   */
  getAgentState(agentName) {
    return this.#agentStates.get(agentName) || AgentStates.IDLE;
  }
}

/** Singleton instance used throughout the orchestrator. */
export const bus = new KomodoEventBus();
