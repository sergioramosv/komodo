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
  ALL_CLIS_RATE_LIMITED: 'cli:all-rate-limited',
  SESSION_AUTO_RESUMED: 'session:auto-resumed',

  // Triage / complexity classification
  TASK_CLASSIFIED: 'task:classified',
  TASK_DECOMPOSED: 'task:decomposed',
  MODEL_SELECTED: 'triage:model-selected',

  // Daemon / watch mode
  DAEMON_STARTED: 'daemon:started',
  DAEMON_IDLE: 'daemon:idle',
  DAEMON_TASK_DETECTED: 'daemon:task-detected',
  DAEMON_STOPPED: 'daemon:stopped',

  // Scheduler events
  SCHEDULER_WAITING: 'scheduler:waiting',
  SCHEDULER_RESUMED: 'scheduler:resumed',

  // Watchdog events
  WATCHDOG_KILL: 'watchdog:kill',
  WATCHDOG_RETRY: 'watchdog:retry',
  WATCHDOG_EXHAUSTED: 'watchdog:exhausted',

  // Graceful shutdown events
  SHUTDOWN_STARTED: 'shutdown:started',
  SHUTDOWN_COMPLETE: 'shutdown:complete',

  // Auto-improve events
  AUTO_IMPROVE_PROPOSALS_GENERATED: 'auto-improve:proposals-generated',

  // Tech debt tracker events
  TECH_DEBT_CREATED: 'tech-debt:created',

  // Dependency checker events
  DEP_CHECK_COMPLETED: 'dep-check:completed',

  // Codebase knowledge index events
  CODEBASE_INDEX_GENERATED: 'codebase-index:generated',

  // Style guide detector events
  STYLE_GUIDE_GENERATED: 'style-guide:generated',

  // Pre-PR test execution events
  PRE_PR_TESTS_START: 'tests:pre-pr:start',
  PRE_PR_TESTS_PASSED: 'tests:pre-pr:passed',
  PRE_PR_TESTS_FAILED: 'tests:pre-pr:failed',

  // CI Monitor events
  CI_MONITOR_START: 'ci:monitor:start',
  CI_PASSED: 'ci:passed',
  CI_FAILED: 'ci:failed',
  CI_AUTO_REVERTED: 'ci:auto-reverted',

  // QA agent events
  QA_TESTS_GENERATED: 'qa:tests-generated',

  // Coverage delta events
  COVERAGE_CHECK_START: 'coverage:check:start',
  COVERAGE_CHECK_COMPLETE: 'coverage:check:complete',
  COVERAGE_CHECK_ERROR: 'coverage:check:error',
  COVERAGE_BASELINE_UPDATED: 'coverage:baseline:updated',

  // Estimation tracker events
  ESTIMATION_RECORDED: 'estimation:recorded',

  // Smart ordering / context affinity events
  CONTEXT_AFFINITY_APPLIED: 'smart-ordering:affinity-applied',

  // Parallel execution events
  PARALLEL_RUN_START: 'parallel:run:start',
  PARALLEL_RUN_COMPLETE: 'parallel:run:complete',
  PARALLEL_PIPELINE_START: 'parallel:pipeline:start',
  PARALLEL_PIPELINE_COMPLETE: 'parallel:pipeline:complete',
  PARALLEL_PIPELINE_ERROR: 'parallel:pipeline:error',
  PARALLEL_RATE_LIMIT_PAUSE: 'parallel:rate-limit:pause',
  PARALLEL_RATE_LIMIT_RESUME: 'parallel:rate-limit:resume',

  // Smart batching events
  BATCH_PREPARED: 'batch:prepared',
  BATCH_TASK_COMPLETE: 'batch:task:complete',
  BATCH_COMPLETE: 'batch:complete',
  BATCH_TASK_SEPARATED: 'batch:task:separated',

  // Worker pool events
  WORKER_STARTED: 'worker:started',
  WORKER_COMPLETED: 'worker:completed',
  WORKER_FAILED: 'worker:failed',
  WORKER_POOL_DRAINED: 'worker-pool:drained',

  // Release events
  RELEASE_CREATED: 'release:created',

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
  AGENT_QA_WORKING: 'agent:qa:working',
  AGENT_QA_DONE: 'agent:qa:done',
  AGENT_QA_IDLE: 'agent:qa:idle',
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
