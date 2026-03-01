'use client';

import { createContext, useContext, useCallback, useRef, useState, useEffect } from 'react';
import type { DashboardEvent, KomodoNotification, NotificationType, KomodoSnapshot } from '@/lib/types';

const MAX_NOTIFICATIONS = 50;
const BUDGET_WARNING_THRESHOLD = 0.8;

let notifCounter = 0;

interface NotificationsContextValue {
  notifications: KomodoNotification[];
  unreadCount: number;
  addNotification: (type: NotificationType, title: string, message: string, source?: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

export const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}

export function useNotificationsStore() {
  const [notifications, setNotifications] = useState<KomodoNotification[]>([]);

  const addNotification = useCallback(
    (type: NotificationType, title: string, message: string, source?: string) => {
      const notif: KomodoNotification = {
        id: `notif-${++notifCounter}`,
        type,
        title,
        message,
        timestamp: new Date().toISOString(),
        read: false,
        source,
      };
      setNotifications((prev) => [notif, ...prev].slice(0, MAX_NOTIFICATIONS));
    },
    [],
  );

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, addNotification, markAsRead, markAllAsRead, clearAll };
}

/**
 * Listens to WebSocket events and snapshot changes, generating notifications.
 */
export function useNotificationEvents(
  events: DashboardEvent[],
  snapshot: KomodoSnapshot | null,
  addNotification: NotificationsContextValue['addNotification'],
) {
  const lastEventIdRef = useRef<string | null>(null);
  const budgetWarned = useRef(false);

  // React to WebSocket events
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (latest.id === lastEventIdRef.current) return;
    lastEventIdRef.current = latest.id;

    switch (latest.type) {
      case 'task:completed':
        addNotification('success', 'Task completed', latest.message, 'task:completed');
        break;
      case 'pr:merged':
        addNotification('success', 'PR merged', latest.message, 'pr:merged');
        break;
      case 'pr:created':
        addNotification('info', 'PR created', latest.message, 'pr:created');
        break;
      case 'agent:state-change': {
        const newState = latest.metadata?.newState as string | undefined;
        if (newState === 'error') {
          addNotification(
            'error',
            'Agent error',
            `${latest.agentName ?? 'Agent'} encountered an error`,
            'agent:state-change',
          );
        }
        break;
      }
      case 'review:cycle:end': {
        const verdict = latest.metadata?.verdict as string | undefined;
        if (verdict === 'REQUEST_CHANGES') {
          addNotification(
            'warning',
            'Changes requested',
            `Review cycle ${latest.metadata?.cycle ?? ''}: changes requested`,
            'review:cycle:end',
          );
        }
        break;
      }
    }
  }, [events, addNotification]);

  // Budget warning based on snapshot
  useEffect(() => {
    if (!snapshot) return;
    const budget = (snapshot as KomodoSnapshot & { budget?: number }).budget;
    if (!budget || budget <= 0) return;

    const ratio = snapshot.totalCost / budget;
    if (ratio >= BUDGET_WARNING_THRESHOLD && !budgetWarned.current) {
      budgetWarned.current = true;
      addNotification(
        'warning',
        'Budget alert',
        `Cost has reached ${Math.round(ratio * 100)}% of the budget ($${snapshot.totalCost.toFixed(2)} / $${budget.toFixed(2)})`,
        'cost:updated',
      );
    }
    if (ratio < BUDGET_WARNING_THRESHOLD) {
      budgetWarned.current = false;
    }
  }, [snapshot, addNotification]);
}
