'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNotifications } from '@/hooks/useNotifications';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '▣' },
  { href: '/agents', label: 'Agents', icon: '⚙' },
  { href: '/analytics', label: 'Analytics', icon: '▤' },
  { href: '/leaderboard', label: 'Leaderboard', icon: '◈' },
  { href: '/history', label: 'History', icon: '◷' },
  { href: '/memory', label: 'Memory', icon: '◉' },
  { href: '/notifications', label: 'Notifications', icon: '▢' },
  { href: '/settings', label: 'Settings', icon: '☰' },
];

export function TopNav() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  return (
    <header className="sticky top-0 z-50 flex h-12 items-center gap-6 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur px-5">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <span className="text-lg font-bold tracking-tight text-white">Komodo</span>
      </Link>

      {/* Nav tabs */}
      <nav className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const showBadge = item.href === '/notifications' && unreadCount > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
              }`}
            >
              <span className="text-xs">{item.icon}</span>
              {item.label}
              {showBadge && (
                <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              {active && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-white" />
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
