import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

/**
 * Estados posibles de un agente en el dashboard.
 */
export const DASHBOARD_AGENT_STATES = {
  IDLE: 'idle',
  WALKING: 'walking',
  WORKING: 'working',
  DONE: 'done',
};

/**
 * Fases del ciclo de Komodo.
 */
export const PHASES = {
  IDLE: 'idle',
  PLANNING: 'planning',
  CODING: 'coding',
  ANALYZING: 'analyzing',
  REVIEWING: 'reviewing',
  MERGING: 'merging',
};

/**
 * Estados de ejecución del orquestador.
 */
export const EXECUTION_STATES = {
  STOPPED: 'stopped',
  RUNNING: 'running',
  PAUSED: 'paused',
  DAEMON_IDLE: 'daemon:idle',
  DAEMON_RUNNING: 'daemon:running',
};

/**
 * Crea el estado inicial de un agente.
 *
 * @param {string} name - Nombre del agente (PLANNER, CODER, REVIEWER)
 * @returns {Object} Estado inicial del agente
 */
function createAgentState(name) {
  return {
    name,
    status: DASHBOARD_AGENT_STATES.IDLE,
    currentTask: null,
    startedAt: null,
    avatar: name.toLowerCase(),
    cli: null,
    model: null,
    totalCost: 0,
    totalTurns: 0,
    completedTasks: 0,
    browserValidation: false,
  };
}

/**
 * Estado global de Komodo.
 *
 * Representa el estado completo del orquestador en cualquier momento.
 * Serializable a JSON para enviar por WebSocket al dashboard.
 */
export class KomodoState {
  constructor() {
    /** @type {Object<string, Object>} */
    this.agents = {
      PLANNER: createAgentState('PLANNER'),
      CODER: createAgentState('CODER'),
      REVIEWER: createAgentState('REVIEWER'),
    };

    /** @type {string} */
    this.phase = PHASES.IDLE;

    /** @type {string|null} */
    this.currentTask = null;

    /** @type {{ id: string, title: string, userStory: string|null, sprint: string|null, devPoints: number|null }|null} */
    this.taskDetails = null;

    /** @type {string|null} */
    this.currentPR = null;

    /** @type {number} */
    this.reviewCycle = 0;

    /** @type {number} */
    this.totalCost = 0;

    /** @type {number} */
    this.tasksCompleted = 0;

    /** @type {number} */
    this.totalTasks = 0;

    /** @type {string} */
    this.executionState = EXECUTION_STATES.STOPPED;

    /**
     * SonarQube analysis state.
     * @type {{ status: 'idle'|'running'|'done'|'error'|'skipped', qualityGate: string|null, issues: Object|null }}
     */
    this.sonarAnalysis = { status: 'idle', qualityGate: null, issues: null };
  }

  /**
   * Devuelve una copia serializable del estado completo.
   *
   * @returns {Object} Snapshot del estado (plain object, JSON-safe)
   */
  getSnapshot() {
    return {
      agents: {
        PLANNER: { ...this.agents.PLANNER },
        CODER: { ...this.agents.CODER },
        REVIEWER: { ...this.agents.REVIEWER },
      },
      phase: this.phase,
      currentTask: this.currentTask,
      taskDetails: this.taskDetails ? { ...this.taskDetails } : null,
      currentPR: this.currentPR,
      reviewCycle: this.reviewCycle,
      totalCost: this.totalCost,
      tasksCompleted: this.tasksCompleted,
      totalTasks: this.totalTasks,
      executionState: this.executionState,
      sonarAnalysis: { ...this.sonarAnalysis },
    };
  }

  /**
   * Actualiza el estado de un agente.
   *
   * @param {string} agentName - Nombre del agente (PLANNER, CODER, REVIEWER)
   * @param {Object} updates - Campos a actualizar
   * @param {string} [updates.status] - Nuevo status (idle|walking|working|done)
   * @param {string|null} [updates.currentTask] - Tarea actual
   * @param {string|null} [updates.startedAt] - Timestamp de inicio
   * @returns {Object} Estado actualizado del agente
   */
  updateAgent(agentName, updates) {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agente desconocido: ${agentName}`);
    }

    const previousStatus = agent.status;
    Object.assign(agent, updates);

    if (updates.status && updates.status !== previousStatus) {
      eventBus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName,
        previousState: previousStatus,
        newState: updates.status,
      });
    }

    return { ...agent };
  }

  /**
   * Actualiza la fase global del orquestador.
   *
   * @param {string} newPhase - Nueva fase (idle|planning|coding|reviewing|merging)
   * @param {Object} [metadata] - Datos adicionales (currentTask, currentPR, etc.)
   * @param {string|null} [metadata.currentTask] - Tarea actual
   * @param {string|null} [metadata.currentPR] - PR actual
   * @param {number} [metadata.reviewCycle] - Ciclo de review actual
   * @param {number} [metadata.totalCost] - Costo total acumulado
   * @param {number} [metadata.tasksCompleted] - Tareas completadas
   * @param {Object|null} [metadata.taskDetails] - Detalles de la tarea actual
   * @param {number} [metadata.totalTasks] - Total de tareas del sprint
   */
  updatePhase(newPhase, metadata = {}) {
    this.phase = newPhase;

    if (metadata.currentTask !== undefined) this.currentTask = metadata.currentTask;
    if (metadata.taskDetails !== undefined) this.taskDetails = metadata.taskDetails;
    if (metadata.currentPR !== undefined) this.currentPR = metadata.currentPR;
    if (metadata.reviewCycle !== undefined) this.reviewCycle = metadata.reviewCycle;
    if (metadata.totalCost !== undefined) this.totalCost = metadata.totalCost;
    if (metadata.tasksCompleted !== undefined) this.tasksCompleted = metadata.tasksCompleted;
    if (metadata.totalTasks !== undefined) this.totalTasks = metadata.totalTasks;
  }

  /**
   * Updates the execution state and emits an event.
   *
   * @param {string} newState - New execution state (stopped|running|paused)
   */
  setExecutionState(newState) {
    const previous = this.executionState;
    if (previous === newState) return;

    this.executionState = newState;
    eventBus.emitEvent(EVENT_TYPES.EXECUTION_STATE_CHANGE, {
      metadata: { previous, current: newState },
    });
  }

  /**
   * @returns {boolean} True if the orchestrator should pause after the current task.
   */
  isPauseRequested() {
    return this.executionState === EXECUTION_STATES.PAUSED;
  }

  /**
   * @returns {boolean} True if the orchestrator should stop immediately.
   */
  isStopRequested() {
    return this.executionState === EXECUTION_STATES.STOPPED;
  }
}

/** Instancia singleton del estado global. */
export const komodoState = new KomodoState();
