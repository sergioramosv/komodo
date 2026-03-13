import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KomodoState, DASHBOARD_AGENT_STATES, PHASES } from './komodo-state.js';
import { eventBus, EVENT_TYPES } from '../events/event-bus.js';

describe('KomodoState', () => {
  let state;

  beforeEach(() => {
    state = new KomodoState();
    // Spy on the real singleton so the mock works regardless of isolate:false
    vi.spyOn(eventBus, 'emitEvent').mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── constructor ────────────────────────────────────────

  describe('constructor', () => {
    it('inicializa los 3 agentes con estado idle', () => {
      expect(state.agents.PLANNER.name).toBe('PLANNER');
      expect(state.agents.PLANNER.status).toBe('idle');
      expect(state.agents.CODER.name).toBe('CODER');
      expect(state.agents.CODER.status).toBe('idle');
      expect(state.agents.REVIEWER.name).toBe('REVIEWER');
      expect(state.agents.REVIEWER.status).toBe('idle');
    });

    it('cada agente tiene todos los campos esperados', () => {
      const agent = state.agents.PLANNER;
      expect(agent).toMatchObject({
        name: 'PLANNER',
        status: 'idle',
        currentTask: null,
        startedAt: null,
        avatar: 'planner',
      });
    });

    it('inicializa estado global en idle con valores por defecto', () => {
      expect(state.phase).toBe('idle');
      expect(state.currentTask).toBeNull();
      expect(state.currentPR).toBeNull();
      expect(state.reviewCycle).toBe(0);
      expect(state.totalCost).toBe(0);
      expect(state.tasksCompleted).toBe(0);
    });
  });

  // ── getSnapshot ────────────────────────────────────────

  describe('getSnapshot', () => {
    it('retorna un objeto plano con todo el estado', () => {
      const snapshot = state.getSnapshot();

      expect(snapshot).toMatchObject({
        phase: 'idle',
        currentTask: null,
        taskDetails: null,
        currentPR: null,
        reviewCycle: 0,
        totalCost: 0,
        tasksCompleted: 0,
        totalTasks: 0,
        multiProject: null,
      });
      expect(snapshot.agents.PLANNER).toMatchObject({ name: 'PLANNER', status: 'idle' });
      expect(snapshot.agents.CODER).toMatchObject({ name: 'CODER', status: 'idle' });
      expect(snapshot.agents.REVIEWER).toMatchObject({ name: 'REVIEWER', status: 'idle' });
    });

    it('es serializable a JSON', () => {
      state.updateAgent('CODER', { status: 'working', currentTask: 'task-123' });
      state.updatePhase('coding', { currentTask: 'task-123' });

      const json = JSON.stringify(state.getSnapshot());
      const parsed = JSON.parse(json);

      expect(parsed.agents.CODER.status).toBe('working');
      expect(parsed.phase).toBe('coding');
    });

    it('retorna una copia independiente (no referencia)', () => {
      const snapshot = state.getSnapshot();
      snapshot.agents.PLANNER.status = 'working';
      snapshot.phase = 'coding';

      expect(state.agents.PLANNER.status).toBe('idle');
      expect(state.phase).toBe('idle');
    });
  });

  // ── updateAgent ────────────────────────────────────────

  describe('updateAgent', () => {
    it('actualiza el status de un agente', () => {
      state.updateAgent('CODER', { status: 'walking' });
      expect(state.agents.CODER.status).toBe('walking');
    });

    it('actualiza múltiples campos a la vez', () => {
      const now = new Date().toISOString();
      state.updateAgent('PLANNER', {
        status: 'working',
        currentTask: 'task-abc',
        startedAt: now,
      });

      expect(state.agents.PLANNER.status).toBe('working');
      expect(state.agents.PLANNER.currentTask).toBe('task-abc');
      expect(state.agents.PLANNER.startedAt).toBe(now);
    });

    it('retorna copia del estado actualizado del agente', () => {
      const result = state.updateAgent('REVIEWER', { status: 'working' });

      expect(result.status).toBe('working');
      result.status = 'done';
      expect(state.agents.REVIEWER.status).toBe('working');
    });

    it('lanza error con agente desconocido', () => {
      expect(() => state.updateAgent('UNKNOWN', { status: 'idle' }))
        .toThrow('Agente desconocido: UNKNOWN');
    });

    it('emite evento AGENT_STATE_CHANGE al cambiar status', () => {
      state.updateAgent('CODER', { status: 'walking' });

      expect(eventBus.emitEvent).toHaveBeenCalledWith(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'CODER',
        previousState: 'idle',
        newState: 'walking',
      });
    });

    it('no emite evento si el status no cambia', () => {
      state.updateAgent('CODER', { status: 'idle' });
      expect(eventBus.emitEvent).not.toHaveBeenCalled();
    });

    it('no emite evento si solo se actualizan otros campos', () => {
      state.updateAgent('CODER', { currentTask: 'task-xyz' });
      expect(eventBus.emitEvent).not.toHaveBeenCalled();
    });
  });

  // ── updatePhase ────────────────────────────────────────

  describe('updatePhase', () => {
    it('actualiza la fase global', () => {
      state.updatePhase('planning');
      expect(state.phase).toBe('planning');
    });

    it('actualiza metadata junto con la fase', () => {
      state.updatePhase('coding', {
        currentTask: 'task-123',
        currentPR: null,
        reviewCycle: 0,
      });

      expect(state.phase).toBe('coding');
      expect(state.currentTask).toBe('task-123');
      expect(state.currentPR).toBeNull();
      expect(state.reviewCycle).toBe(0);
    });

    it('solo actualiza campos presentes en metadata', () => {
      state.updatePhase('coding', { currentTask: 'task-1' });
      state.updatePhase('reviewing', { currentPR: 'PR-42' });

      expect(state.currentTask).toBe('task-1');
      expect(state.currentPR).toBe('PR-42');
    });

    it('maneja metadata vacía sin error', () => {
      expect(() => state.updatePhase('merging')).not.toThrow();
      expect(state.phase).toBe('merging');
    });

    it('actualiza tasksCompleted y totalCost', () => {
      state.updatePhase('idle', { tasksCompleted: 5, totalCost: 0.42 });

      expect(state.tasksCompleted).toBe(5);
      expect(state.totalCost).toBe(0.42);
    });
  });

  // ── constants ──────────────────────────────────────────

  describe('constants', () => {
    it('DASHBOARD_AGENT_STATES contiene todos los estados del dashboard', () => {
      expect(DASHBOARD_AGENT_STATES.IDLE).toBe('idle');
      expect(DASHBOARD_AGENT_STATES.WALKING).toBe('walking');
      expect(DASHBOARD_AGENT_STATES.WORKING).toBe('working');
      expect(DASHBOARD_AGENT_STATES.DONE).toBe('done');
    });

    it('PHASES contiene todas las fases del ciclo', () => {
      expect(PHASES.IDLE).toBe('idle');
      expect(PHASES.PLANNING).toBe('planning');
      expect(PHASES.CODING).toBe('coding');
      expect(PHASES.REVIEWING).toBe('reviewing');
      expect(PHASES.MERGING).toBe('merging');
    });
  });
});
