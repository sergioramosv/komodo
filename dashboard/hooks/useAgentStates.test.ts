import { describe, it, expect } from 'vitest';
import { getAgentActivity, useAgentStates, DEFAULT_AGENTS } from './useAgentStates';
import type { AgentState, KomodoSnapshot, Phase } from '@/lib/types';

/* ── Helpers ── */

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    name: 'PLANNER',
    status: 'idle',
    currentTask: null,
    startedAt: null,
    avatar: '',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<KomodoSnapshot> = {}): KomodoSnapshot {
  return {
    agents: {
      PLANNER: makeAgent({ name: 'PLANNER' }),
      CODER: makeAgent({ name: 'CODER' }),
      REVIEWER: makeAgent({ name: 'REVIEWER' }),
    },
    phase: 'idle',
    currentTask: null,
    currentPR: null,
    reviewCycle: 0,
    totalCost: 0,
    tasksCompleted: 0,
    ...overrides,
  };
}

/* ── getAgentActivity ── */

describe('getAgentActivity', () => {
  it('returns null for idle agents', () => {
    const agent = makeAgent({ status: 'idle' });
    expect(getAgentActivity(agent, 'planning')).toBeNull();
  });

  it('returns "Walking to desk..." for walking agents', () => {
    const agent = makeAgent({ status: 'walking' });
    expect(getAgentActivity(agent, 'coding')).toBe('Walking to desk...');
  });

  it('returns "Done!" for done agents', () => {
    const agent = makeAgent({ status: 'done' });
    expect(getAgentActivity(agent, 'planning')).toBe('Done!');
  });

  it('returns currentTask when working and task exists', () => {
    const agent = makeAgent({ status: 'working', currentTask: 'Implement login' });
    expect(getAgentActivity(agent, 'coding')).toBe('Implement login');
  });

  describe('working without currentTask — derives from agentName + phase', () => {
    it('PLANNER during planning phase', () => {
      const agent = makeAgent({ name: 'PLANNER', status: 'working' });
      expect(getAgentActivity(agent, 'planning')).toBe('Planning tasks...');
    });

    it('PLANNER during non-planning phase returns null', () => {
      const agent = makeAgent({ name: 'PLANNER', status: 'working' });
      expect(getAgentActivity(agent, 'coding')).toBeNull();
    });

    it('CODER during coding phase', () => {
      const agent = makeAgent({ name: 'CODER', status: 'working' });
      expect(getAgentActivity(agent, 'coding')).toBe('Writing code...');
    });

    it('CODER during non-coding phase returns null', () => {
      const agent = makeAgent({ name: 'CODER', status: 'working' });
      expect(getAgentActivity(agent, 'reviewing')).toBeNull();
    });

    it('REVIEWER during reviewing phase', () => {
      const agent = makeAgent({ name: 'REVIEWER', status: 'working' });
      expect(getAgentActivity(agent, 'reviewing')).toBe('Reviewing PR...');
    });

    it('REVIEWER during non-reviewing phase returns null', () => {
      const agent = makeAgent({ name: 'REVIEWER', status: 'working' });
      expect(getAgentActivity(agent, 'planning')).toBeNull();
    });
  });
});

/* ── useAgentStates ── */

describe('useAgentStates', () => {
  it('returns DEFAULT_AGENTS when snapshot is null', () => {
    const result = useAgentStates(null, false);
    expect(result.agents).toEqual(DEFAULT_AGENTS);
    expect(result.phase).toBe('idle');
    expect(result.connected).toBe(false);
  });

  it('passes through connected status when snapshot is null', () => {
    const result = useAgentStates(null, true);
    expect(result.connected).toBe(true);
  });

  it('enriches agents with activity from getAgentActivity', () => {
    const snapshot = makeSnapshot({
      phase: 'coding',
      agents: {
        PLANNER: makeAgent({ name: 'PLANNER', status: 'idle' }),
        CODER: makeAgent({ name: 'CODER', status: 'working' }),
        REVIEWER: makeAgent({ name: 'REVIEWER', status: 'idle' }),
      },
    });

    const result = useAgentStates(snapshot, true);
    expect(result.agents.CODER.activity).toBe('Writing code...');
    expect(result.agents.PLANNER.activity).toBeNull();
    expect(result.agents.REVIEWER.activity).toBeNull();
  });

  it('sets reviewCycle only for REVIEWER', () => {
    const snapshot = makeSnapshot({ reviewCycle: 3 });

    const result = useAgentStates(snapshot, true);
    expect(result.agents.REVIEWER.reviewCycle).toBe(3);
    expect(result.agents.PLANNER.reviewCycle).toBe(0);
    expect(result.agents.CODER.reviewCycle).toBe(0);
  });

  it('returns correct phase from snapshot', () => {
    const snapshot = makeSnapshot({ phase: 'reviewing' });

    const result = useAgentStates(snapshot, true);
    expect(result.phase).toBe('reviewing');
  });
});
