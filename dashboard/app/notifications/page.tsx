'use client';

import { useState } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
import type { NotificationType } from '@/lib/types';

const TYPE_FILTERS: { value: NotificationType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'success', label: 'Success' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const TYPE_STYLES: Record<NotificationType, { bg: string; text: string; icon: string }> = {
  success: { bg: 'bg-green-500/10', text: 'text-green-400', icon: '✓' },
  info:    { bg: 'bg-blue-500/10',  text: 'text-blue-400',  icon: 'ℹ' },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-400', icon: '▲' },
  error:   { bg: 'bg-red-500/10',   text: 'text-red-400',   icon: '✕' },
};

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
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
            <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notification List */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center">
          <p className="text-neutral-500">
            {notifications.length === 0
              ? 'No notifications yet'
              : 'No notifications match this filter'}
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
                onClick={() => !notif.read && markRead(notif.id)}
                className={`flex items-start gap-3 rounded-lg border border-neutral-800 p-4 transition-colors ${
                  notif.read
                    ? 'bg-neutral-900/50'
                    : 'cursor-pointer bg-neutral-900 hover:bg-neutral-800/50'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.bg} ${style.text} text-sm`}
                >
                  {style.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-sm font-semibold ${
                        notif.read ? 'text-neutral-400' : 'text-neutral-100'
                      }`}
                    >
                      {notif.title}
                    </p>
                    {!notif.read && (
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <p className={`mt-0.5 text-xs ${notif.read ? 'text-neutral-600' : 'text-neutral-400'}`}>
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
