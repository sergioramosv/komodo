'use client';

import React from 'react';
import { NotificationsContext, useNotificationsStore, useNotificationEvents } from '@/hooks/useNotifications';
import { useKomodoSocket } from '@/hooks/useKomodoSocket';
import { ToastContainer } from '@/components/toast-container';
import { Sidebar } from '@/components/sidebar';

/**
 * Client-side provider that wraps the app with notification context.
 * Connects to WebSocket events and generates notifications automatically.
 * Also renders the Sidebar (which needs notification context for the badge).
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const store = useNotificationsStore();
  const { events, snapshot } = useKomodoSocket();

  useNotificationEvents(events, snapshot, store.addNotification);

  return (
    <NotificationsContext.Provider value={store}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
      <ToastContainer />
    </NotificationsContext.Provider>
  );
}
