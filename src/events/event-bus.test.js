import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KomodoEventBus, EVENT_TYPES, AGENT_STATES } from './event-bus.js';

describe('KomodoEventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new KomodoEventBus();
  });

  // ── emitEvent ──────────────────────────────────────────

  describe('emitEvent', () => {
    it('emite un evento con payload estandarizado', () => {
      const payload = bus.emitEvent(EVENT_TYPES.TASK_STARTED, {
        agentName: 'PLANNER',
        metadata: { taskId: '123' },
      });

      expect(payload.type).toBe(EVENT_TYPES.TASK_STARTED);
      expect(payload.agentName).toBe('PLANNER');
      expect(payload.metadata).toEqual({ taskId: '123' });
      expect(payload.timestamp).toBeTruthy();
      expect(payload.previousState).toBeNull();
      expect(payload.newState).toBeNull();
    });

    it('incluye previousState y newState en el payload', () => {
      const payload = bus.emitEvent(EVENT_TYPES.AGENT_STATE_CHANGE, {
        agentName: 'CODER',
        previousState: AGENT_STATES.IDLE,
        newState: AGENT_STATES.WORKING,
      });

      expect(payload.previousState).toBe('idle');
      expect(payload.newState).toBe('working');
    });

    it('funciona sin data (usa defaults)', () => {
      const payload = bus.emitEvent(EVENT_TYPES.TASK_COMPLETED);

      expect(payload.type).toBe(EVENT_TYPES.TASK_COMPLETED);
      expect(payload.agentName).toBeNull();
      expect(payload.previousState).toBeNull();
      expect(payload.newState).toBeNull();
      expect(payload.metadata).toEqual({});
    });

    it('notifica a listeners específicos del evento', () => {
      const listener = vi.fn();
      bus.on(EVENT_TYPES.PR_CREATED, listener);

      bus.emitEvent(EVENT_TYPES.PR_CREATED, {
        metadata: { prNumber: 42 },
      });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].metadata.prNumber).toBe(42);
    });

    it('retorna el payload emitido', () => {
      const result = bus.emitEvent(EVENT_TYPES.REVIEW_CYCLE, {
        agentName: 'REVIEWER',
      });

      expect(result).toHaveProperty('type', EVENT_TYPES.REVIEW_CYCLE);
      expect(result).toHaveProperty('agentName', 'REVIEWER');
    });
  });

  // ── onAny ──────────────────────────────────────────────

  describe('onAny', () => {
    it('recibe todos los eventos independientemente del tipo', () => {
      const listener = vi.fn();
      bus.onAny(listener);

      bus.emitEvent(EVENT_TYPES.TASK_STARTED);
      bus.emitEvent(EVENT_TYPES.PR_CREATED);
      bus.emitEvent(EVENT_TYPES.COST_UPDATED);

      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener.mock.calls[0][0].type).toBe(EVENT_TYPES.TASK_STARTED);
      expect(listener.mock.calls[1][0].type).toBe(EVENT_TYPES.PR_CREATED);
      expect(listener.mock.calls[2][0].type).toBe(EVENT_TYPES.COST_UPDATED);
    });

    it('múltiples onAny listeners reciben todos los eventos', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      bus.onAny(listenerA);
      bus.onAny(listenerB);

      bus.emitEvent(EVENT_TYPES.TASK_STARTED);

      expect(listenerA).toHaveBeenCalledOnce();
      expect(listenerB).toHaveBeenCalledOnce();
    });
  });

  // ── unsubscribe ────────────────────────────────────────

  describe('unsubscribe', () => {
    it('onAny retorna función de desuscripción que funciona', () => {
      const listener = vi.fn();
      const unsub = bus.onAny(listener);

      bus.emitEvent(EVENT_TYPES.TASK_STARTED);
      expect(listener).toHaveBeenCalledOnce();

      unsub();

      bus.emitEvent(EVENT_TYPES.TASK_COMPLETED);
      expect(listener).toHaveBeenCalledOnce(); // no se incrementa
    });

    it('desuscribir un listener no afecta a otros', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      const unsubA = bus.onAny(listenerA);
      bus.onAny(listenerB);

      unsubA();

      bus.emitEvent(EVENT_TYPES.TASK_STARTED);
      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).toHaveBeenCalledOnce();
    });
  });

  // ── removeAllListeners ─────────────────────────────────

  describe('removeAllListeners', () => {
    it('limpia _anyListeners al llamar sin argumentos', () => {
      const listener = vi.fn();
      bus.onAny(listener);

      bus.removeAllListeners();

      bus.emitEvent(EVENT_TYPES.TASK_STARTED);
      expect(listener).not.toHaveBeenCalled();
    });

    it('no limpia _anyListeners al llamar con eventName específico', () => {
      const anyListener = vi.fn();
      bus.onAny(anyListener);

      bus.removeAllListeners(EVENT_TYPES.TASK_STARTED);

      bus.emitEvent(EVENT_TYPES.TASK_STARTED);
      expect(anyListener).toHaveBeenCalledOnce();
    });

    it('retorna this para encadenamiento', () => {
      const result = bus.removeAllListeners();
      expect(result).toBe(bus);
    });
  });

  // ── edge cases ─────────────────────────────────────────

  describe('edge cases', () => {
    it('listener de onAny que lanza error no crashea el bus', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const badListener = () => { throw new Error('boom'); };
      const goodListener = vi.fn();

      bus.onAny(badListener);
      bus.onAny(goodListener);

      expect(() => {
        bus.emitEvent(EVENT_TYPES.TASK_STARTED);
      }).not.toThrow();

      expect(goodListener).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        'EventBus: onAny listener error',
        expect.any(Error),
      );

      warnSpy.mockRestore();
    });

    it('emitir evento sin listeners no causa error', () => {
      expect(() => {
        bus.emitEvent(EVENT_TYPES.TASK_STARTED);
      }).not.toThrow();
    });

    it('desuscribir múltiples veces no causa error', () => {
      const listener = vi.fn();
      const unsub = bus.onAny(listener);

      unsub();
      unsub();
      unsub();

      bus.emitEvent(EVENT_TYPES.TASK_STARTED);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── constants ──────────────────────────────────────────

  describe('constants', () => {
    it('EVENT_TYPES contiene todos los tipos esperados', () => {
      expect(EVENT_TYPES.AGENT_STATE_CHANGE).toBe('agent:state-change');
      expect(EVENT_TYPES.TASK_STARTED).toBe('task:started');
      expect(EVENT_TYPES.TASK_COMPLETED).toBe('task:completed');
      expect(EVENT_TYPES.REVIEW_CYCLE).toBe('review:cycle');
      expect(EVENT_TYPES.PR_CREATED).toBe('pr:created');
      expect(EVENT_TYPES.PR_MERGED).toBe('pr:merged');
      expect(EVENT_TYPES.COST_UPDATED).toBe('cost:updated');
    });

    it('AGENT_STATES contiene todos los estados esperados', () => {
      expect(AGENT_STATES.IDLE).toBe('idle');
      expect(AGENT_STATES.WORKING).toBe('working');
      expect(AGENT_STATES.WAITING).toBe('waiting');
    });
  });
});
