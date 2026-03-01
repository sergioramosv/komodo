export type AgentName = 'PLANNER' | 'CODER' | 'REVIEWER';

export type AgentStatus = 'idle' | 'walking' | 'working' | 'done';

export type Phase = 'idle' | 'planning' | 'coding' | 'reviewing' | 'merging';

export type ExecutionState = 'stopped' | 'running' | 'paused';

export interface AgentState {
  name: AgentName;
  status: AgentStatus;
  currentTask: string | null;
  startedAt: string | null;
  avatar: string;
  cli?: string | null;
  model?: string | null;
  totalCost?: number;
  totalTurns?: number;
  completedTasks?: number;
  browserValidation?: boolean;
}

/* ── Agent Logs ── */

export interface AgentLog {
  id: string;
  timestamp: string;
  kind: 'tool' | 'text' | 'status';
  content: string;
  detail?: string;
}

export interface TaskDetails {
  id: string;
  title: string;
  userStory: string | null;
  sprint: string | null;
  devPoints: number | null;
}

export interface KomodoSnapshot {
  agents: Record<AgentName, AgentState>;
  phase: Phase;
  currentTask: string | null;
  taskDetails?: TaskDetails | null;
  currentPR: string | null;
  reviewCycle: number;
  totalCost: number;
  tasksCompleted: number;
  totalTasks?: number;
  executionState?: ExecutionState;
}

export interface DashboardEvent {
  id: string;
  type: string;
  timestamp: string;
  agentName: string | null;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface WsSnapshotMessage {
  type: 'snapshot';
  data: KomodoSnapshot;
}

export interface WsEventMessage {
  type: 'event';
  data: {
    type: string;
    timestamp: string;
    agentName: string | null;
    previousState: string | null;
    newState: string | null;
    metadata: Record<string, unknown>;
  };
}

export interface WsCommandAckMessage {
  type: 'command:ack';
  command: string;
}

export type WsMessage = WsSnapshotMessage | WsEventMessage | WsCommandAckMessage;

/* ── Notifications ── */

export type NotificationType = 'success' | 'warning' | 'error' | 'info';

export interface KomodoNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}
