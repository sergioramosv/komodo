export type AgentModel = 'sonnet' | 'opus' | 'haiku';

export interface AgentConfig {
  model: AgentModel;
  maxTurns: number;
}

export interface KomodoConfig {
  activeProjectId: string;
  agents: {
    planner: AgentConfig;
    coder: AgentConfig;
    reviewer: AgentConfig;
  };
  maxReviewCycles: number;
  budgetLimit: number;
  continuousMode: boolean;
}

export const DEFAULT_CONFIG: KomodoConfig = {
  activeProjectId: '',
  agents: {
    planner: { model: 'sonnet', maxTurns: 30 },
    coder: { model: 'sonnet', maxTurns: 30 },
    reviewer: { model: 'sonnet', maxTurns: 30 },
  },
  maxReviewCycles: 5,
  budgetLimit: 0,
  continuousMode: false,
};

export interface Project {
  id: string;
  name: string;
}
