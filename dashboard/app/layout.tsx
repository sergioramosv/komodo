import type { Metadata } from 'next';
import { NotificationsProvider } from '@/components/notifications-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Komodo Dashboard',
  description: 'Control panel for the Komodo AI orchestrator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="flex h-screen bg-neutral-950 text-neutral-100 antialiased">
        <NotificationsProvider>
          {children}
        </NotificationsProvider>
      </body>
    </html>
  );
}
