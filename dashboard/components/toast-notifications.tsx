'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
import type { KomodoNotification, NotificationType } from '@/lib/types';

const TOAST_DURATION = 5000;
const MAX_VISIBLE = 5;

const TYPE_STYLES: Record<NotificationType, { border: string; icon: string; iconColor: string }> = {
  success: { border: 'border-green-500/40', icon: '✓', iconColor: 'text-green-400' },
  warning: { border: 'border-amber-500/40', icon: '▲', iconColor: 'text-amber-400' },
  error:   { border: 'border-red-500/40',   icon: '✕', iconColor: 'text-red-400' },
  info:    { border: 'border-blue-500/40',   icon: 'ℹ', iconColor: 'text-blue-400' },
};

interface ToastItem {
  notification: KomodoNotification;
  leaving: boolean;
}

export function ToastContainer() {
  const { notifications } = useNotifications();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.notification.id === id ? { ...t, leaving: true } : t)),
    );
    // Remove after exit animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.notification.id !== id));
    }, 300);
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  // Watch for new notifications
  useEffect(() => {
    if (notifications.length === 0) return;
    const latest = notifications[0];
    if (seenRef.current.has(latest.id)) return;
    seenRef.current.add(latest.id);

    setToasts((prev) => {
      const next = [{ notification: latest, leaving: false }, ...prev];
      // Dismiss excess toasts
      if (next.length > MAX_VISIBLE) {
        const excess = next.slice(MAX_VISIBLE);
        excess.forEach((t) => dismiss(t.notification.id));
      }
      return next.slice(0, MAX_VISIBLE);
    });

    // Auto-dismiss timer
    const timer = setTimeout(() => dismiss(latest.id), TOAST_DURATION);
    timersRef.current.set(latest.id, timer);
  }, [notifications, dismiss]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-2" style={{ maxWidth: '380px' }}>
      {toasts.map((toast) => {
        const style = TYPE_STYLES[toast.notification.type];
        return (
          <div
            key={toast.notification.id}
            className={`toast-enter ${toast.leaving ? 'toast-leave' : ''} flex items-start gap-3 rounded-lg border ${style.border} bg-neutral-900 p-4 shadow-lg`}
          >
            <span className={`mt-0.5 text-base ${style.iconColor}`}>{style.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-100">{toast.notification.title}</p>
              <p className="mt-0.5 text-xs text-neutral-400">{toast.notification.message}</p>
            </div>
            <button
              onClick={() => dismiss(toast.notification.id)}
              className="shrink-0 text-neutral-500 hover:text-neutral-300"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
