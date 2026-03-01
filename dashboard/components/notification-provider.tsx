'use client';

import { NotificationsContext, useNotificationsProvider } from '@/hooks/useNotifications';
import { ToastContainer } from '@/components/toast-notifications';

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const state = useNotificationsProvider();

  return (
    <NotificationsContext.Provider value={state}>
      {children}
      <ToastContainer />
    </NotificationsContext.Provider>
  );
}
