'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '▣' },
  { href: '/agents', label: 'Agents', icon: '⚙' },
  { href: '/memory', label: 'Memory', icon: '◉' },
  { href: '/settings', label: 'Settings', icon: '☰' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-neutral-800 bg-neutral-950 text-neutral-300">
      <div className="flex h-14 items-center gap-2 border-b border-neutral-800 px-4">
        <span className="text-lg font-bold tracking-tight text-white">Komodo</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
