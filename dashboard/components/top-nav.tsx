'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNotifications } from '@/hooks/useNotifications';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/agents', label: 'Agents' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/history', label: 'History' },
  { href: '/memory', label: 'Memory' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/settings', label: 'Settings' },
];

export function TopNav() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-800/60 bg-neutral-950/80 backdrop-blur-xl">
      <div className="flex h-11 items-center px-4">
        {/* Logo */}
        <Link href="/" className="mr-6 flex items-center gap-2 shrink-0">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/20 text-xs font-black text-emerald-400">K</div>
          <span className="text-sm font-semibold tracking-tight text-neutral-200">Komodo</span>
        </Link>

        {/* Divider */}
        <div className="h-4 w-px bg-neutral-800 mr-4" />

        {/* Nav */}
        <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-none -mb-px">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const showBadge = item.href === '/notifications' && unreadCount > 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors ${
                  active
                    ? 'text-white'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {item.label}
                {showBadge && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-x-3 -bottom-px h-px bg-white" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
