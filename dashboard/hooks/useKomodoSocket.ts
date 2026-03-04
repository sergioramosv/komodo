'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { KomodoSnapshot, WsMessage, WsEventMessage, DashboardEvent, AgentLog } from '@/lib/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
const RECONNECT_DELAY = 3000;
const MAX_EVENTS = 20;
const MAX_AGENT_LOGS = 200;

interface UseKomodoSocketReturn {
  snapshot: KomodoSnapshot | null;
  connected: boolean;
  events: DashboardEvent[];
  agentLogs: Record<string, AgentLog[]>;
  sendCommand: (command: 'pause' | 'stop') => void;
}

let eventCounter = 0;
let logCounter = 0;

export function useKomodoSocket(): UseKomodoSocketReturn {
  const [snapshot, setSnapshot] = useState<KomodoSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [agentLogs, setAgentLogs] = useState<Record<string, AgentLog[]>>({});
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

  return { snapshot, connected, events, agentLogs, sendCommand };
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
