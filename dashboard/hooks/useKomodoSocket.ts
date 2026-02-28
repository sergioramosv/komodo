'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { KomodoSnapshot, WsMessage, WsEventMessage } from '@/lib/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
const RECONNECT_DELAY = 3000;

interface UseKomodoSocketReturn {
  snapshot: KomodoSnapshot | null;
  connected: boolean;
}

export function useKomodoSocket(): UseKomodoSocketReturn {
  const [snapshot, setSnapshot] = useState<KomodoSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
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

  return { snapshot, connected };
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
      break;
    case 'task:completed':
      next.tasksCompleted = prev.tasksCompleted + 1;
      next.currentTask = null;
      break;
    case 'pr:created':
      next.currentPR = (event.metadata as { prUrl?: string }).prUrl ?? next.currentPR;
      break;
    case 'pr:merged':
      next.currentPR = null;
      break;
  }

  return next;
}
