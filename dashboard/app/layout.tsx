import type { Metadata } from 'next';
import { TopNav } from '@/components/top-nav';
import { NotificationProvider } from '@/components/notification-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Komodo Dashboard',
  description: 'Control panel for the Komodo AI orchestrator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="flex flex-col h-screen bg-neutral-950 text-neutral-100 antialiased" suppressHydrationWarning>
        <NotificationProvider>
          <TopNav />
          <main className="flex-1 overflow-y-auto p-4">{children}</main>
        </NotificationProvider>
      </body>
    </html>
  );
}
