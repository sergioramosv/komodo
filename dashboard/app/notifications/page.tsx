'use client';

import { useState } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
import type { NotificationType } from '@/lib/types';

const TYPE_STYLES: Record<NotificationType, { icon: string; color: string; bg: string }> = {
  success: { icon: '✓', color: 'text-green-400', bg: 'bg-green-500/10' },
  warning: { icon: '⚠', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  error: { icon: '✕', color: 'text-red-400', bg: 'bg-red-500/10' },
  info: { icon: 'ℹ', color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

const FILTER_OPTIONS: { value: NotificationType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'info', label: 'Info' },
];

export default function NotificationsPage() {
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const [filter, setFilter] = useState<NotificationType | 'all'>('all');

  const filtered = filter === 'all'
    ? notifications
    : notifications.filter((n) => n.type === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Notifications</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-bold text-white">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700"
            >
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-300"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === opt.value
                ? 'bg-neutral-700 text-white'
                : 'bg-neutral-800/60 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Notification List */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center">
          <p className="text-neutral-500">
            {notifications.length === 0 ? 'No notifications yet' : 'No notifications match this filter'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((notif) => {
            const style = TYPE_STYLES[notif.type];
            const time = new Date(notif.timestamp).toLocaleTimeString();
            const date = new Date(notif.timestamp).toLocaleDateString();

            return (
              <div
                key={notif.id}
                onClick={() => !notif.read && markAsRead(notif.id)}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                  notif.read
                    ? 'border-neutral-800 bg-neutral-900/50'
                    : 'border-neutral-700 bg-neutral-900'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${style.bg} ${style.color}`}
                >
                  {style.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${notif.read ? 'text-neutral-400' : 'text-neutral-100'}`}>
                      {notif.title}
                    </p>
                    {!notif.read && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <p className={`mt-0.5 text-xs ${notif.read ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    {notif.message}
                  </p>
                  <p className="mt-1 text-xs text-neutral-600">
                    {date} {time}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
