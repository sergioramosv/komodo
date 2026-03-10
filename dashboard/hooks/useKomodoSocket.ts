'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { KomodoSnapshot, WsMessage, WsEventMessage, DashboardEvent, AgentLog, CliHealth, CliName, MultiProjectState } from '@/lib/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
const RECONNECT_DELAY = 3000;
const MAX_EVENTS = 20;
const MAX_AGENT_LOGS = 200;

const DEFAULT_CLI_HEALTH: Record<CliName, CliHealth> = {
  claude: { cli: 'claude', status: 'available', lastHeartbeat: null, rateLimitedAt: null, cooldownMinutes: null },
  codex: { cli: 'codex', status: 'available', lastHeartbeat: null, rateLimitedAt: null, cooldownMinutes: null },
  gemini: { cli: 'gemini', status: 'available', lastHeartbeat: null, rateLimitedAt: null, cooldownMinutes: null },
};

interface UseKomodoSocketReturn {
  snapshot: KomodoSnapshot | null;
  connected: boolean;
  events: DashboardEvent[];
  agentLogs: Record<string, AgentLog[]>;
  cliHealth: Record<CliName, CliHealth>;
  sendCommand: (command: 'pause' | 'stop') => void;
}

let eventCounter = 0;
let logCounter = 0;

export function useKomodoSocket(): UseKomodoSocketReturn {
  const [snapshot, setSnapshot] = useState<KomodoSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [agentLogs, setAgentLogs] = useState<Record<string, AgentLog[]>>({});
  const [cliHealth, setCliHealth] = useState<Record<CliName, CliHealth>>({ ...DEFAULT_CLI_HEALTH });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);

        if (msg.type === 'snapshot') {
          setSnapshot(msg.data);
        } else if (msg.type === 'event') {
          const eventData = msg.data;

          // Handle agent:output → accumulate in agent logs
          if (eventData.type === 'agent:output' && eventData.agentName) {
            const meta = eventData.metadata as Record<string, string>;
            const log: AgentLog = {
              id: `log-${++logCounter}`,
              timestamp: eventData.timestamp,
              kind: (meta?.kind as AgentLog['kind']) || 'text',
              content: meta?.tool || meta?.text || '',
              detail: meta?.input,
            };
            const agentName = eventData.agentName;
            setAgentLogs((prev) => {
              const current = prev[agentName] || [];
              return {
                ...prev,
                [agentName]: [...current, log].slice(-MAX_AGENT_LOGS),
              };
            });
            // Don't add agent:output to the main event timeline
            return;
          }

          // Update CLI health from heartbeat/rate-limit events
          if (eventData.type === 'agent:rate-limit') {
            const meta = eventData.metadata as Record<string, unknown>;
            const cli = meta.cli as CliName | undefined;
            if (cli) {
              setCliHealth((prev) => ({
                ...prev,
                [cli]: {
                  ...prev[cli],
                  status: 'rate-limited' as const,
                  rateLimitedAt: eventData.timestamp,
                  cooldownMinutes: (meta.cooldownMinutes as number) ?? 15,
                },
              }));
            }
          } else if (eventData.type === 'cli:heartbeat') {
            const meta = eventData.metadata as Record<string, unknown>;
            const cli = meta.cli as CliName | undefined;
            if (cli) {
              setCliHealth((prev) => ({
                ...prev,
                [cli]: {
                  ...prev[cli],
                  lastHeartbeat: eventData.timestamp,
                },
              }));
            }
          } else if (eventData.type === 'cli:recovered') {
            const meta = eventData.metadata as Record<string, unknown>;
            const cli = meta.cli as CliName | undefined;
            if (cli) {
              setCliHealth((prev) => ({
                ...prev,
                [cli]: {
                  ...prev[cli],
                  status: 'available' as const,
                  lastHeartbeat: eventData.timestamp,
                  rateLimitedAt: null,
                  cooldownMinutes: null,
                },
              }));
            }
          }

          // Apply incremental updates based on event type
          setSnapshot((prev) => {
            if (!prev) return prev;
            return applyEvent(prev, eventData);
          });

          // Track event in timeline
          const dashEvent = formatEvent(eventData);
          if (dashEvent) {
            setEvents((prev) => [dashEvent, ...prev].slice(0, MAX_EVENTS));
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  const sendCommand = useCallback((command: 'pause' | 'stop') => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', command }));
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { snapshot, connected, events, agentLogs, cliHealth, sendCommand };
}

function applyEvent(
  prev: KomodoSnapshot,
  event: WsEventMessage['data'],
): KomodoSnapshot {
  const next = { ...prev, agents: { ...prev.agents } };

  switch (event.type) {
    case 'agent:state-change': {
      const name = event.agentName as keyof typeof next.agents;
      if (next.agents[name]) {
        next.agents[name] = {
          ...next.agents[name],
          status: (event.newState as KomodoSnapshot['agents']['PLANNER']['status']) ?? next.agents[name].status,
        };
      }
      break;
    }
    case 'task:started':
      next.currentTask = (event.metadata as { taskId?: string }).taskId ?? next.currentTask;
      if ((event.metadata as { taskDetails?: KomodoSnapshot['taskDetails'] }).taskDetails) {
        next.taskDetails = (event.metadata as { taskDetails: KomodoSnapshot['taskDetails'] }).taskDetails;
      }
      break;
    case 'task:completed':
      next.tasksCompleted = prev.tasksCompleted + 1;
      next.currentTask = null;
      next.taskDetails = null;
      break;
    case 'pr:created':
      next.currentPR = (event.metadata as { prUrl?: string }).prUrl ?? next.currentPR;
      break;
    case 'pr:merged':
      next.currentPR = null;
      break;
    case 'cost:updated':
      if (typeof (event.metadata as { totalCost?: number }).totalCost === 'number') {
        next.totalCost = (event.metadata as { totalCost: number }).totalCost;
      }
      break;
    case 'review:cycle:start':
      if (typeof (event.metadata as { cycle?: number }).cycle === 'number') {
        next.reviewCycle = (event.metadata as { cycle: number }).cycle;
      }
      break;
    case 'execution:state-change':
      if ((event.metadata as { current?: string }).current) {
        next.executionState = (event.metadata as { current: string }).current as KomodoSnapshot['executionState'];
      }
      break;
    case 'browser:check': {
      const agent = event.agentName as keyof typeof next.agents | null;
      if (agent && next.agents[agent]) {
        next.agents[agent] = {
          ...next.agents[agent],
          browserValidation: (event.metadata as { status?: string }).status === 'start',
        };
      }
      break;
    }
    case 'sonar:analysis:start':
      next.sonarAnalysis = { status: 'running', qualityGate: null, issues: null };
      break;
    case 'sonar:analysis:complete': {
      const report = (event.metadata as Record<string, unknown>).report as Record<string, unknown> | undefined;
      next.sonarAnalysis = {
        status: 'done',
        qualityGate: (report?.qualityGate as string) ?? null,
        issues: (report?.issues as NonNullable<KomodoSnapshot['sonarAnalysis']>['issues']) ?? null,
      };
      break;
    }
    case 'sonar:analysis:error':
      next.sonarAnalysis = { status: 'error', qualityGate: null, issues: null };
      break;
    case 'budget:updated': {
      const m = event.metadata as Record<string, unknown>;
      next.budget = {
        dailySpent: (m.dailySpent as number) ?? 0,
        weeklySpent: (m.weeklySpent as number) ?? 0,
        dailyBudget: (m.dailyBudget as number) ?? 0,
        weeklyBudget: (m.weeklyBudget as number) ?? 0,
        paused: prev.budget?.paused ?? false,
      };
      break;
    }
    case 'budget:exceeded':
      next.budget = { ...(prev.budget ?? { dailySpent: 0, weeklySpent: 0, dailyBudget: 0, weeklyBudget: 0, paused: false }), paused: true };
      break;
    case 'multi-project:run-started': {
      const mp = event.metadata as Record<string, unknown>;
      next.multiProject = {
        enabled: true,
        projects: (mp.projects as string[]) ?? [],
        strategy: (mp.strategy as string) ?? 'round-robin',
        activeProject: null,
        perProject: {},
      };
      break;
    }
    case 'multi-project:project-selected':
    case 'multi-project:project-switch': {
      const mp = event.metadata as Record<string, unknown>;
      if (next.multiProject) {
        next.multiProject = {
          ...next.multiProject,
          activeProject: (mp.projectId as string) ?? next.multiProject.activeProject,
        };
      }
      break;
    }
    case 'multi-project:run-completed': {
      if (next.multiProject) {
        const mp = event.metadata as Record<string, unknown>;
        const perProject = mp.perProject as MultiProjectState['perProject'] | undefined;
        next.multiProject = {
          ...next.multiProject,
          activeProject: null,
          ...(perProject ? { perProject } : {}),
        };
      }
      break;
    }
  }

  // Update multi-project perProject stats if present in metadata
  if (next.multiProject && event.metadata) {
    const meta = event.metadata as Record<string, unknown>;
    if (meta.perProject && typeof meta.perProject === 'object') {
      next.multiProject = {
        ...next.multiProject,
        perProject: meta.perProject as MultiProjectState['perProject'],
      };
    }
  }

  return next;
}

function formatEvent(event: WsEventMessage['data']): DashboardEvent | null {
  const meta = event.metadata as Record<string, unknown>;
  let message: string;

  switch (event.type) {
    case 'agent:state-change':
      message = `${event.agentName} changed to ${event.newState}`;
      break;
    case 'task:started':
      message = `Task ${meta.taskId ?? ''} started`;
      break;
    case 'task:completed':
      message = `Task completed`;
      break;
    case 'pr:created':
      message = `PR #${meta.prNumber ?? ''} created`;
      break;
    case 'pr:merged':
      message = `PR merged`;
      break;
    case 'cost:updated':
      message = `Cost updated: $${typeof meta.totalCost === 'number' ? meta.totalCost.toFixed(2) : '?'}`;
      break;
    case 'review:cycle:start':
      message = `Review cycle ${meta.cycle ?? ''} started`;
      break;
    case 'review:cycle:end':
      message = `Review cycle ${meta.cycle ?? ''} ended — ${meta.verdict ?? 'done'}`;
      break;
    case 'execution:state-change':
      message = `Execution state changed to ${meta.current ?? 'unknown'}`;
      break;
    case 'browser:check': {
      const url = meta.url as string | undefined;
      const errors = meta.errors as string[] | undefined;
      const status = meta.status as string | undefined;
      if (status === 'start') {
        message = `Browser check started${url ? `: ${url}` : ''}`;
      } else if (errors && errors.length > 0) {
        message = `Browser check found ${errors.length} error${errors.length > 1 ? 's' : ''}${url ? ` on ${url}` : ''}`;
      } else {
        message = `Browser check passed${url ? `: ${url}` : ''}`;
      }
      break;
    }
    case 'sonar:analysis:start':
      message = 'SonarQube analysis started';
      break;
    case 'sonar:analysis:complete': {
      const report = (meta.report as Record<string, unknown>) ?? {};
      message = `SonarQube analysis complete — Quality Gate: ${report.qualityGate ?? 'N/A'}`;
      break;
    }
    case 'sonar:analysis:error':
      message = `SonarQube analysis failed: ${meta.reason ?? 'unknown error'}`;
      break;
    case 'agent:rate-limit':
      message = `CLI ${meta.cli ?? '?'} hit rate limit${meta.pattern ? `: ${meta.pattern}` : ''}`;
      break;
    case 'cli:recovered':
      message = `CLI ${meta.cli ?? '?'} recovered${meta.autoResume ? ' (auto-resuming)' : ''}`;
      break;
    case 'cli:heartbeat':
      return null; // Silent update, don't show in event timeline
    case 'session:auto-resumed':
      message = `Session auto-resumed on ${meta.cli ?? '?'} after ${meta.downtimeMinutes ?? '?'}min downtime`;
      break;
    case 'budget:updated':
      return null; // Silent update — reflected in budget widget
    case 'budget:warning':
      message = `Budget warning — daily: $${typeof meta.dailySpent === 'number' ? meta.dailySpent.toFixed(2) : '?'} (${meta.percentDaily ?? '?'}%)`;
      break;
    case 'budget:exceeded':
      message = `Budget exceeded — daemon auto-paused`;
      break;
    case 'budget:reset':
      message = `Budget counters reset for day ${meta.day ?? ''}`;
      break;
    case 'multi-project:run-started':
      message = `Multi-project run started with ${(meta.projects as string[])?.length ?? '?'} projects`;
      break;
    case 'multi-project:project-selected':
    case 'multi-project:project-switch':
      message = `Switched to project ${meta.projectId ?? '?'}`;
      break;
    case 'multi-project:run-completed':
      message = `Multi-project run completed`;
      break;
    case 'multi-project:all-backlogs-empty':
      message = `All project backlogs are empty`;
      break;
    default:
      message = event.type;
  }

  return {
    id: `evt-${++eventCounter}`,
    type: event.type,
    timestamp: event.timestamp,
    agentName: event.agentName,
    message,
    metadata: meta,
  };
}
