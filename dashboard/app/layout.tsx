import type { Metadata } from 'next';
import { Sidebar } from '@/components/sidebar';
import { NotificationProvider } from '@/components/notification-provider';
import { ViewPreferenceProvider } from '@/context/view-preference-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Komodo Dashboard',
  description: 'Control panel for the Komodo AI orchestrator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="flex h-screen bg-neutral-950 text-neutral-100 antialiased" suppressHydrationWarning>
        <NotificationProvider>
          <ViewPreferenceProvider>
            <Sidebar />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </ViewPreferenceProvider>
        </NotificationProvider>
      </body>
    </html>
  );
}
