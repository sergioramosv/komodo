export type CliProvider = 'claude' | 'codex' | 'gemini';

export type ClaudeModel = 'sonnet' | 'opus' | 'haiku';
export type CodexModel = 'codex-mini' | 'o4-mini' | 'o3';
export type GeminiModel = 'gemini-2.0-flash' | 'gemini-2.5-pro';

export type AgentModel = string;

export const CLI_MODELS: Record<CliProvider, { value: string; label: string }[]> = {
  claude: [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
    { value: 'haiku', label: 'Haiku' },
  ],
  codex: [
    { value: 'codex-mini', label: 'Codex Mini' },
    { value: 'o4-mini', label: 'O4 Mini' },
    { value: 'o3', label: 'O3' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
};

export const CLI_OPTIONS: { value: CliProvider; label: string; icon: string }[] = [
  { value: 'claude', label: 'Claude', icon: '🟠' },
  { value: 'codex', label: 'Codex', icon: '🟢' },
  { value: 'gemini', label: 'Gemini', icon: '🔵' },
];

export const DEFAULT_MODELS: Record<CliProvider, string> = {
  claude: 'sonnet',
  codex: 'o4-mini',
  gemini: 'gemini-2.5-pro',
};

export interface AgentConfig {
  cli: CliProvider;
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
  availableClis?: CliProvider[];
}

export const DEFAULT_CONFIG: KomodoConfig = {
  activeProjectId: '',
  agents: {
    planner: { cli: 'claude', model: 'sonnet', maxTurns: 30 },
    coder: { cli: 'claude', model: 'sonnet', maxTurns: 30 },
    reviewer: { cli: 'claude', model: 'sonnet', maxTurns: 30 },
  },
  maxReviewCycles: 5,
  budgetLimit: 0,
  continuousMode: false,
};

export interface Project {
  id: string;
  name: string;
}
