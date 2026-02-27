// ═══════════════════════════════════════════
// KOMODO STATE — Modelo de estado global
// ═══════════════════════════════════════════

/**
 * Estados posibles de un agente en el dashboard.
 *
 * - idle:    en la sala de espera
 * - walking: yendo al escritorio (animación de transición)
 * - working: trabajando en su tarea
 * - done:    volviendo a la sala de espera
 */
export const AGENT_STATUS = Object.freeze({
  IDLE: 'idle',
  WALKING: 'walking',
  WORKING: 'working',
  DONE: 'done',
});

/**
 * Fases del flujo global de Komodo.
 */
export const PHASES = Object.freeze({
  IDLE: 'idle',
  PLANNING: 'planning',
  CODING: 'coding',
  REVIEWING: 'reviewing',
  MERGING: 'merging',
});

/** Nombres de agentes válidos */
const VALID_AGENTS = ['PLANNER', 'CODER', 'REVIEWER'];

/** Avatares por defecto para cada agente */
const DEFAULT_AVATARS = Object.freeze({
  PLANNER: '📋',
  CODER: '💻',
  REVIEWER: '🔍',
});

// ═══════════════════════════════════════════
// TIPOS (JSDoc)
// ═══════════════════════════════════════════

/**
 * @typedef {'idle' | 'walking' | 'working' | 'done'} AgentStatus
 */

/**
 * @typedef {'idle' | 'planning' | 'coding' | 'reviewing' | 'merging'} Phase
 */

/**
 * @typedef {Object} AgentState
 * @property {string} name - Nombre del agente (PLANNER, CODER, REVIEWER)
 * @property {AgentStatus} status - Estado actual del agente
 * @property {string|null} currentTask - Tarea en la que trabaja (null si idle)
 * @property {string|null} startedAt - ISO timestamp de inicio (null si idle)
 * @property {string} avatar - Emoji/avatar del agente
 */

/**
 * @typedef {Object} GlobalState
 * @property {Phase} phase - Fase actual del flujo
 * @property {string|null} currentTask - ID/nombre de la tarea activa
 * @property {string|null} currentPR - URL o número del PR activo
 * @property {number} reviewCycle - Número de ciclo de review actual
 * @property {number} totalCost - Costo acumulado (reservado para futuro uso)
 * @property {number} tasksCompleted - Tareas completadas en la sesión
 */

/**
 * @typedef {Object} KomodoSnapshot
 * @property {Phase} phase - Fase actual del flujo
 * @property {string|null} currentTask - Tarea activa
 * @property {string|null} currentPR - PR activo
 * @property {number} reviewCycle - Ciclo de review
 * @property {number} totalCost - Costo acumulado
 * @property {number} tasksCompleted - Tareas completadas
 * @property {Object.<string, AgentState>} agents - Estado de cada agente
 * @property {string} timestamp - ISO timestamp del snapshot
 */

// ═══════════════════════════════════════════
// CLASE PRINCIPAL
// ═══════════════════════════════════════════

/**
 * Modelo de estado global de Komodo.
 *
 * Centraliza el estado de los agentes y del flujo para que el dashboard
 * y la animación sepan exactamente qué pintar en cada momento.
 *
 * - Cada agente tiene: name, status, currentTask, startedAt, avatar
 * - El estado global tiene: phase, currentTask, currentPR, reviewCycle, etc.
 * - getSnapshot() devuelve un objeto plano serializable a JSON (para WebSocket)
 */
class KomodoState {
  constructor() {
    /** @type {Object.<string, AgentState>} */
    this._agents = {};

    // Inicializar cada agente en estado idle
    for (const name of VALID_AGENTS) {
      this._agents[name] = {
        name,
        status: AGENT_STATUS.IDLE,
        currentTask: null,
        startedAt: null,
        avatar: DEFAULT_AVATARS[name],
      };
    }

    /** @type {Phase} */
    this._phase = PHASES.IDLE;

    /** @type {string|null} */
    this._currentTask = null;

    /** @type {string|null} */
    this._currentPR = null;

    /** @type {number} */
    this._reviewCycle = 0;

    /** @type {number} */
    this._totalCost = 0;

    /** @type {number} */
    this._tasksCompleted = 0;
  }

  // ─────────────────────────────────────────
  // GETTERS
  // ─────────────────────────────────────────

  /** @returns {Phase} */
  get phase() {
    return this._phase;
  }

  /** @returns {string|null} */
  get currentTask() {
    return this._currentTask;
  }

  /** @returns {string|null} */
  get currentPR() {
    return this._currentPR;
  }

  /** @returns {number} */
  get reviewCycle() {
    return this._reviewCycle;
  }

  /** @returns {number} */
  get totalCost() {
    return this._totalCost;
  }

  /** @returns {number} */
  get tasksCompleted() {
    return this._tasksCompleted;
  }

  // ─────────────────────────────────────────
  // MÉTODOS PRINCIPALES
  // ─────────────────────────────────────────

  /**
   * Devuelve un snapshot completo del estado, serializable a JSON.
   * Ideal para enviar por WebSocket al dashboard.
   *
   * @returns {KomodoSnapshot}
   */
  getSnapshot() {
    // Clonar agentes para evitar referencias mutables
    const agents = {};
    for (const [key, agent] of Object.entries(this._agents)) {
      agents[key] = { ...agent };
    }

    return {
      phase: this._phase,
      currentTask: this._currentTask,
      currentPR: this._currentPR,
      reviewCycle: this._reviewCycle,
      totalCost: this._totalCost,
      tasksCompleted: this._tasksCompleted,
      agents,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Actualiza el estado de un agente.
   *
   * @param {string} name - Nombre del agente (PLANNER, CODER, REVIEWER)
   * @param {Object} updates - Campos a actualizar
   * @param {AgentStatus} [updates.status] - Nuevo status del agente
   * @param {string|null} [updates.currentTask] - Tarea actual
   * @param {string} [updates.avatar] - Nuevo avatar
   * @returns {AgentState} Estado actualizado del agente
   */
  updateAgent(name, updates = {}) {
    if (!VALID_AGENTS.includes(name)) {
      throw new Error(
        `Agente desconocido: "${name}". Válidos: ${VALID_AGENTS.join(', ')}`
      );
    }

    const agent = this._agents[name];

    // Validar status si se proporciona
    if (updates.status !== undefined) {
      const validStatuses = Object.values(AGENT_STATUS);
      if (!validStatuses.includes(updates.status)) {
        throw new Error(
          `Status inválido: "${updates.status}". Válidos: ${validStatuses.join(', ')}`
        );
      }
      agent.status = updates.status;
    }

    // Actualizar currentTask
    if ('currentTask' in updates) {
      agent.currentTask = updates.currentTask;
    }

    // Actualizar avatar
    if (updates.avatar !== undefined) {
      agent.avatar = updates.avatar;
    }

    // Gestionar startedAt automáticamente
    if (agent.status === AGENT_STATUS.WORKING && !agent.startedAt) {
      agent.startedAt = new Date().toISOString();
    } else if (agent.status === AGENT_STATUS.IDLE || agent.status === AGENT_STATUS.DONE) {
      agent.startedAt = null;
    }

    return { ...agent };
  }

  /**
   * Actualiza la fase global del flujo y opcionalmente otros campos globales.
   *
   * @param {Object} updates - Campos a actualizar
   * @param {Phase} [updates.phase] - Nueva fase
   * @param {string|null} [updates.currentTask] - Tarea activa
   * @param {string|null} [updates.currentPR] - PR activo
   * @param {number} [updates.reviewCycle] - Ciclo de review
   * @param {number} [updates.totalCost] - Costo acumulado
   * @param {number} [updates.tasksCompleted] - Tareas completadas
   * @returns {KomodoSnapshot} Snapshot post-actualización
   */
  updatePhase(updates = {}) {
    // Validar phase si se proporciona
    if (updates.phase !== undefined) {
      const validPhases = Object.values(PHASES);
      if (!validPhases.includes(updates.phase)) {
        throw new Error(
          `Fase inválida: "${updates.phase}". Válidas: ${validPhases.join(', ')}`
        );
      }
      this._phase = updates.phase;
    }

    if ('currentTask' in updates) {
      this._currentTask = updates.currentTask;
    }

    if ('currentPR' in updates) {
      this._currentPR = updates.currentPR;
    }

    if (updates.reviewCycle !== undefined) {
      this._reviewCycle = updates.reviewCycle;
    }

    if (updates.totalCost !== undefined) {
      this._totalCost = updates.totalCost;
    }

    if (updates.tasksCompleted !== undefined) {
      this._tasksCompleted = updates.tasksCompleted;
    }

    return this.getSnapshot();
  }

  /**
   * Obtiene el estado de un agente específico.
   *
   * @param {string} name - Nombre del agente
   * @returns {AgentState} Copia del estado del agente
   */
  getAgent(name) {
    if (!VALID_AGENTS.includes(name)) {
      throw new Error(
        `Agente desconocido: "${name}". Válidos: ${VALID_AGENTS.join(', ')}`
      );
    }
    return { ...this._agents[name] };
  }

  /**
   * Reinicia todo el estado a valores iniciales.
   * Útil entre sesiones o al empezar un nuevo ciclo de tareas.
   */
  reset() {
    for (const name of VALID_AGENTS) {
      this._agents[name] = {
        name,
        status: AGENT_STATUS.IDLE,
        currentTask: null,
        startedAt: null,
        avatar: DEFAULT_AVATARS[name],
      };
    }

    this._phase = PHASES.IDLE;
    this._currentTask = null;
    this._currentPR = null;
    this._reviewCycle = 0;
    this._totalCost = 0;
    this._tasksCompleted = 0;
  }
}

/** Singleton — una sola instancia para toda la app */
export const komodoState = new KomodoState();

/** Exportar la clase para testing */
export { KomodoState };
