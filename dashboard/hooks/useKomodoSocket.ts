'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { KomodoSnapshot, WsMessage, WsEventMessage, DashboardEvent } from '@/lib/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
const RECONNECT_DELAY = 3000;
const MAX_EVENTS = 20;

interface UseKomodoSocketReturn {
  snapshot: KomodoSnapshot | null;
  connected: boolean;
  events: DashboardEvent[];
}

let eventCounter = 0;

export function useKomodoSocket(): UseKomodoSocketReturn {
  const [snapshot, setSnapshot] = useState<KomodoSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
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
          // Apply incremental updates based on event type
          setSnapshot((prev) => {
            if (!prev) return prev;
            return applyEvent(prev, msg.data);
          });

          // Track event in timeline
          const dashEvent = formatEvent(msg.data);
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

  return { snapshot, connected, events };
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
