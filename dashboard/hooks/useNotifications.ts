'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import type { KomodoNotification, NotificationType, WsMessage } from '@/lib/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
const RECONNECT_DELAY = 3000;
const MAX_NOTIFICATIONS = 100;
const BUDGET_WARN_THRESHOLD = 0.8;

let notifCounter = 0;

export interface NotificationsState {
  notifications: KomodoNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

const defaultState: NotificationsState = {
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
  clearAll: () => {},
};

export const NotificationsContext = createContext<NotificationsState>(defaultState);

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext);
}

export function useNotificationsProvider(): NotificationsState {
  const [notifications, setNotifications] = useState<KomodoNotification[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const budgetLimitRef = useRef<number>(0);
  const budgetWarnedRef = useRef(false);

  const addNotification = useCallback(
    (type: NotificationType, title: string, message: string) => {
      const notif: KomodoNotification = {
        id: `notif-${++notifCounter}`,
        type,
        title,
        message,
        timestamp: new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => [notif, ...prev].slice(0, MAX_NOTIFICATIONS));
    },
    [],
  );

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Fetch budget limit from config
  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((cfg) => {
        if (typeof cfg.budgetLimit === 'number') {
          budgetLimitRef.current = cfg.budgetLimit;
        }
      })
      .catch(() => {});
  }, []);

  // WebSocket connection for notification events
  useEffect(() => {
    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          if (msg.type !== 'event') return;

          const evt = msg.data;
          const meta = evt.metadata as Record<string, unknown>;

          switch (evt.type) {
            case 'task:completed':
              addNotification('success', 'Task completed', 'A task has been completed successfully');
              break;

            case 'pr:merged':
              addNotification('success', 'PR merged', `Pull request has been merged successfully`);
              break;

            case 'pr:created': {
              const prNum = meta.prNumber;
              addNotification('info', 'PR created', `Pull request #${prNum ?? ''} has been created`);
              break;
            }

            case 'cost:updated': {
              const totalCost = meta.totalCost as number | undefined;
              const budget = budgetLimitRef.current;
              if (
                budget > 0 &&
                typeof totalCost === 'number' &&
                totalCost >= budget * BUDGET_WARN_THRESHOLD &&
                !budgetWarnedRef.current
              ) {
                budgetWarnedRef.current = true;
                const pct = Math.round((totalCost / budget) * 100);
                addNotification(
                  'warning',
                  'Budget warning',
                  `Cost has reached ${pct}% of the budget limit ($${totalCost.toFixed(2)} / $${budget.toFixed(2)})`,
                );
              }
              break;
            }

            case 'agent:state-change': {
              const newState = evt.newState;
              if (newState === 'error' || newState === 'failed') {
                addNotification(
                  'error',
                  'Agent error',
                  `${evt.agentName ?? 'Agent'} has encountered an error`,
                );
              }
              break;
            }

            case 'review:cycle:end': {
              const verdict = meta.verdict as string | undefined;
              if (verdict === 'REQUEST_CHANGES') {
                addNotification(
                  'warning',
                  'Changes requested',
                  `Review cycle ${meta.cycle ?? ''} — changes have been requested`,
                );
              }
              break;
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [addNotification]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, markRead, markAllRead, clearAll };
}
