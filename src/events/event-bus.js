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

  // Budget manager events
  BUDGET_UPDATED: 'budget:updated',
  BUDGET_WARNING: 'budget:warning',
  BUDGET_EXCEEDED: 'budget:exceeded',
  BUDGET_RESET: 'budget:reset',

  // Review depth events
  REVIEW_DEPTH_SELECTED: 'review:depth:selected',

  // SonarQube analysis events
  SONAR_ANALYSIS_START: 'sonar:analysis:start',
  SONAR_ANALYSIS_COMPLETE: 'sonar:analysis:complete',
  SONAR_ANALYSIS_ERROR: 'sonar:analysis:error',

  // Rate limit detection
  RATE_LIMIT_DETECTED: 'agent:rate-limit',
  RATE_LIMIT_PREEMPTIVE_WAIT: 'rate-limit:preemptive-wait',
  RATE_LIMIT_FORECAST_UPDATED: 'rate-limit:forecast:updated',
  BUDGET_STRATEGY_APPLIED: 'budget:strategy:applied',

  // Agent fallback on rate limit
  AGENT_FALLBACK: 'agent:fallback',

  // Checkpoint persistence
  SESSION_CHECKPOINTED: 'session:checkpointed',

  // Heartbeat monitor
  CLI_HEARTBEAT: 'cli:heartbeat',
  CLI_RECOVERED: 'cli:recovered',
  ALL_CLIS_RATE_LIMITED: 'cli:all-rate-limited',
  SESSION_AUTO_RESUMED: 'session:auto-resumed',

  // Triage / complexity classification
  TASK_CLASSIFIED: 'task:classified',
  TASK_DECOMPOSED: 'task:decomposed',
  MODEL_SELECTED: 'triage:model-selected',
  MODEL_ESCALATED: 'triage:model-escalated',
  SMART_ROUTING_APPLIED: 'triage:smart-routing-applied',

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
  CACHE_HIT: 'cache:hit',
  CACHE_MISS: 'cache:miss',

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

  // Canary merge events
  CANARY_STAGING_CREATED: 'canary:staging:created',
  CANARY_CI_WAITING: 'canary:ci:waiting',
  CANARY_CI_PASSED: 'canary:ci:passed',
  CANARY_CI_FAILED: 'canary:ci:failed',
  CANARY_AUTO_FIX_ATTEMPT: 'canary:auto-fix:attempt',
  CANARY_AUTO_FIX_SUCCEEDED: 'canary:auto-fix:succeeded',
  CANARY_AUTO_FIX_FAILED: 'canary:auto-fix:failed',
  CANARY_PROMOTED: 'canary:promoted',
  CANARY_ROLLED_BACK: 'canary:rolled-back',
  CANARY_PARALLEL_CONFLICT: 'canary:parallel-conflict',

  // QA agent events
  QA_TESTS_GENERATED: 'qa:tests-generated',

  // Tester agent events
  TESTER_TESTS_GENERATED: 'tester:tests-generated',
  TESTER_TESTS_FAILED: 'tester:tests-failed',
  TESTER_TESTS_PASSED: 'tester:tests-passed',
  AGENT_TESTER_WORKING: 'agent:tester:working',
  AGENT_TESTER_DONE: 'agent:tester:done',
  AGENT_TESTER_IDLE: 'agent:tester:idle',

  // Coverage delta events
  COVERAGE_CHECK_START: 'coverage:check:start',
  COVERAGE_CHECK_COMPLETE: 'coverage:check:complete',
  COVERAGE_CHECK_ERROR: 'coverage:check:error',
  COVERAGE_BASELINE_UPDATED: 'coverage:baseline:updated',

  // Estimation tracker events
  ESTIMATION_RECORDED: 'estimation:recorded',
  TOKEN_ESTIMATION_RECORDED: 'token:estimation:recorded',

  // Model performance tracker events
  MODEL_PERFORMANCE_RECORDED: 'metrics:model-performance:recorded',

  // Smart ordering / context affinity events
  CONTEXT_AFFINITY_APPLIED: 'smart-ordering:affinity-applied',

  // Knowledge Graph events
  KNOWLEDGE_GRAPH_SAVED: 'knowledge:graph:saved',
  KNOWLEDGE_LESSONS_EXTRACTED: 'knowledge:lessons:extracted',

  // Cross-project intelligence events
  CROSS_PROJECT_PATTERN_PROMOTED: 'cross-project:pattern:promoted',
  CROSS_PROJECT_ANTI_PATTERN_PROPAGATED: 'cross-project:anti-pattern:propagated',
  GLOBAL_MODEL_PERF_UPDATED: 'cross-project:model-perf:updated',

  // Parallel execution events
  PARALLEL_RUN_START: 'parallel:run:start',
  PARALLEL_RUN_COMPLETE: 'parallel:run:complete',
  PARALLEL_PIPELINE_START: 'parallel:pipeline:start',
  PARALLEL_PIPELINE_COMPLETE: 'parallel:pipeline:complete',
  PARALLEL_PIPELINE_ERROR: 'parallel:pipeline:error',
  PARALLEL_RATE_LIMIT_PAUSE: 'parallel:rate-limit:pause',
  PARALLEL_RATE_LIMIT_RESUME: 'parallel:rate-limit:resume',

  // Intra-task parallel execution events (Security + Tester in parallel)
  PARALLEL_INTRA_START: 'parallel:intra:start',
  PARALLEL_INTRA_SECURITY_DONE: 'parallel:intra:security:done',
  PARALLEL_INTRA_TESTER_CANCELLED: 'parallel:intra:tester:cancelled',
  PARALLEL_INTRA_COMPLETE: 'parallel:intra:complete',

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
  RELEASE_GATE_PASSED: 'release:gate:passed',
  RELEASE_GATE_BLOCKED: 'release:gate:blocked',

  // Webhook outgoing events
  WEBHOOK_SENT: 'webhook:sent',
  WEBHOOK_FAILED: 'webhook:failed',

  // Weekly digest events
  WEEKLY_DIGEST: 'digest:weekly',

  // Circuit breaker events
  CIRCUIT_OPEN: 'circuit:open',
  CIRCUIT_HALF_OPEN: 'circuit:half-open',
  CIRCUIT_CLOSED: 'circuit:closed',

  // Error budget events
  ERROR_BUDGET_EXHAUSTED: 'error-budget:exhausted',

  // Dead letter queue events
  DEAD_LETTER_QUEUED: 'dead-letter:queued',

  // Phase change events
  PHASE_CHANGE: 'phase:change',

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
  AGENT_ARCHITECT_WORKING: 'agent:architect:working',
  AGENT_ARCHITECT_DONE: 'agent:architect:done',
  AGENT_ARCHITECT_IDLE: 'agent:architect:idle',

  // Autonomy level events
  GUARDIAN_GATE_TRIGGERED: 'guardian:gate:triggered',
  AUTONOMY_APPROVAL_REQUESTED: 'autonomy:approval:requested',
  AUTONOMY_APPROVED: 'autonomy:approved',
  AUTONOMY_REJECTED: 'autonomy:rejected',
  AUTONOMY_TIMED_OUT: 'autonomy:timed-out',
  AUTONOMY_AUTO_APPROVED: 'autonomy:auto-approved',
  AUTONOMY_LEVEL_LOADED: 'autonomy:level:loaded',

  // Streaming early termination events
  EARLY_TERMINATION: 'streaming:early-termination',
  WATCHDOG_ALERT: 'streaming:watchdog-alert',
  REVIEWER_EARLY_APPROVED: 'streaming:reviewer-early-approved',
  ANOMALY_DETECTED: 'streaming:anomaly-detected',

  // Self-healing events
  SELF_HEALING_ATTEMPTED: 'self-healing:attempted',
  SELF_HEALING_SUCCEEDED: 'self-healing:succeeded',
  SELF_HEALING_FAILED: 'self-healing:failed',
  SELF_HEALING_OFFLINE_MODE: 'self-healing:offline-mode',
  SELF_HEALING_SYNC_COMPLETED: 'self-healing:sync-completed',
  SELF_HEAL_RECOVERED: 'self-heal:recovered',
  SELF_HEAL_EXHAUSTED: 'self-heal:exhausted',

  // Codebase learning events
  CODEBASE_LEARNING_STARTED: 'codebase-learning:started',
  CODEBASE_LEARNING_COMPLETED: 'codebase-learning:completed',

  // Structured event log
  STRUCTURED_EVENT_LOGGED: 'structured-event:logged',
  TASK_TOKEN_METRICS_UPDATED: 'task:token-metrics:updated',

  // Observability replay system
  TASK_TIMELINE_QUERIED: 'observability:timeline:queried',
  DECISION_EXPLAINED: 'observability:decision:explained',

  // Observability anomaly alerting
  ANOMALY_ALERT: 'observability:anomaly:alert',

  // Pipeline Scheduler events
  PIPELINE_SCHEDULER_STARTED: 'pipeline-scheduler:started',
  PIPELINE_SCHEDULER_COMPLETE: 'pipeline-scheduler:complete',
  PIPELINE_SCHEDULER_TASK_QUEUED: 'pipeline-scheduler:task:queued',
  PIPELINE_SCHEDULER_STAGE_WAITING: 'pipeline-scheduler:stage:waiting',
  PIPELINE_SCHEDULER_STAGE_ACQUIRED: 'pipeline-scheduler:stage:acquired',
  PIPELINE_SCHEDULER_TASK_COMPLETE: 'pipeline-scheduler:task:complete',
  PIPELINE_SCHEDULER_TASK_FAILED: 'pipeline-scheduler:task:failed',
  CLI_SLOT_ACQUIRED: 'pipeline-scheduler:cli-slot:acquired',
  CLI_SLOT_RELEASED: 'pipeline-scheduler:cli-slot:released',
  CLI_SLOT_RATE_LIMITED: 'pipeline-scheduler:cli-slot:rate-limited',
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
