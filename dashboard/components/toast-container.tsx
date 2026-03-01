'use client';

import { useEffect, useState, useCallback } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
import type { KomodoNotification, NotificationType } from '@/lib/types';

const TOAST_DURATION_MS = 5000;
const MAX_VISIBLE_TOASTS = 4;

const TYPE_STYLES: Record<NotificationType, { border: string; icon: string; iconColor: string }> = {
  success: { border: 'border-green-500/40', icon: '✓', iconColor: 'text-green-400' },
  warning: { border: 'border-amber-500/40', icon: '⚠', iconColor: 'text-amber-400' },
  error: { border: 'border-red-500/40', icon: '✕', iconColor: 'text-red-400' },
  info: { border: 'border-blue-500/40', icon: 'ℹ', iconColor: 'text-blue-400' },
};

interface ToastItem {
  notification: KomodoNotification;
  exiting: boolean;
}

export function ToastContainer() {
  const { notifications, markAsRead } = useNotifications();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);

  // Watch for new notifications and add toasts
  useEffect(() => {
    if (notifications.length === 0) return;
    const latest = notifications[0];
    if (latest.id === lastSeenId) return;
    setLastSeenId(latest.id);

    setToasts((prev) => {
      const alreadyExists = prev.some((t) => t.notification.id === latest.id);
      if (alreadyExists) return prev;
      return [{ notification: latest, exiting: false }, ...prev].slice(0, MAX_VISIBLE_TOASTS);
    });
  }, [notifications, lastSeenId]);

  // Auto-dismiss toasts
  useEffect(() => {
    if (toasts.length === 0) return;

    const timer = setTimeout(() => {
      setToasts((prev) => {
        if (prev.length === 0) return prev;
        // Mark the oldest toast as exiting
        const last = prev[prev.length - 1];
        if (last.exiting) {
          // Remove it
          return prev.slice(0, -1);
        }
        // Start exit animation
        return prev.map((t, i) =>
          i === prev.length - 1 ? { ...t, exiting: true } : t,
        );
      });
    }, TOAST_DURATION_MS);

    return () => clearTimeout(timer);
  }, [toasts]);

  const dismissToast = useCallback(
    (id: string) => {
      setToasts((prev) => prev.filter((t) => t.notification.id !== id));
      markAsRead(id);
    },
    [markAsRead],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-2" style={{ maxWidth: '360px' }}>
      {toasts.map((toast) => {
        const style = TYPE_STYLES[toast.notification.type];
        return (
          <div
            key={toast.notification.id}
            className={`toast-enter flex items-start gap-3 rounded-lg border bg-neutral-900 p-3 shadow-lg shadow-black/30 ${style.border} ${
              toast.exiting ? 'toast-exit' : ''
            }`}
          >
            <span className={`mt-0.5 text-lg leading-none ${style.iconColor}`}>{style.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-100">{toast.notification.title}</p>
              <p className="mt-0.5 text-xs text-neutral-400">{toast.notification.message}</p>
            </div>
            <button
              onClick={() => dismissToast(toast.notification.id)}
              className="shrink-0 text-neutral-500 hover:text-neutral-300"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
