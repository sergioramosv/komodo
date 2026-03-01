'use client';

import type { AgentName, AgentState, KomodoSnapshot, Phase } from '@/lib/types';

export interface AgentVisualState extends AgentState {
  /** What the agent is currently doing — for tooltip display */
  activity: string | null;
  /** Review cycle number (only meaningful for REVIEWER) */
  reviewCycle: number;
}

export interface UseAgentStatesReturn {
  agents: Record<AgentName, AgentVisualState>;
  phase: Phase;
  connected: boolean;
}

export const DEFAULT_AGENTS: Record<AgentName, AgentVisualState> = {
  PLANNER: { name: 'PLANNER', status: 'idle', currentTask: null, startedAt: null, avatar: '', activity: null, reviewCycle: 0 },
  CODER: { name: 'CODER', status: 'idle', currentTask: null, startedAt: null, avatar: '', activity: null, reviewCycle: 0 },
  REVIEWER: { name: 'REVIEWER', status: 'idle', currentTask: null, startedAt: null, avatar: '', activity: null, reviewCycle: 0 },
};

export function getAgentActivity(agent: AgentState, phase: Phase): string | null {
  if (agent.status === 'idle') return null;
  if (agent.status === 'walking') return 'Walking to desk...';
  if (agent.status === 'done') return 'Done!';

  // Browser validation mode takes priority
  if (agent.browserValidation) return 'Browser validation...';

  // Working — derive activity from agent name + phase
  if (agent.currentTask) return agent.currentTask;

  switch (agent.name) {
    case 'PLANNER':
      return phase === 'planning' ? 'Planning tasks...' : null;
    case 'CODER':
      return phase === 'coding' ? 'Writing code...' : null;
    case 'REVIEWER':
      return phase === 'reviewing' ? 'Reviewing PR...' : null;
    default:
      return null;
  }
}

/**
 * Hook that derives enriched agent visual states from a snapshot.
 * Receives snapshot and connected status from the caller (useKomodoSocket)
 * to avoid creating duplicate WebSocket connections.
 */
export function useAgentStates(
  snapshot: KomodoSnapshot | null,
  connected: boolean,
): UseAgentStatesReturn {
  if (!snapshot) {
    return { agents: DEFAULT_AGENTS, phase: 'idle', connected };
  }

  const agents = {} as Record<AgentName, AgentVisualState>;
  for (const name of ['PLANNER', 'CODER', 'REVIEWER'] as AgentName[]) {
    const agent = snapshot.agents[name];
    agents[name] = {
      ...agent,
      activity: getAgentActivity(agent, snapshot.phase),
      reviewCycle: name === 'REVIEWER' ? snapshot.reviewCycle : 0,
    };
  }

  return { agents, phase: snapshot.phase, connected };
}
