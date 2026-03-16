'use client';

import type { ViewType } from '@/context/view-preference-context';

interface ViewToggleProps {
  view: ViewType;
  onToggle: (v: ViewType) => void;
}

export function ViewToggle({ view, onToggle }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
      <button
        onClick={() => onToggle('3d')}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
          view === '3d'
            ? 'bg-neutral-700 text-white'
            : 'text-neutral-500 hover:text-neutral-300'
        }`}
        title="3D Office view"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M6 1L11 4V8L6 11L1 8V4L6 1Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" fill="none"/>
          <path d="M6 1V11M1 4L6 7L11 4" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round"/>
        </svg>
        3D
      </button>
      <button
        onClick={() => onToggle('pixel')}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
          view === 'pixel'
            ? 'bg-neutral-700 text-white'
            : 'text-neutral-500 hover:text-neutral-300'
        }`}
        title="Pixel Office view"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1" y="1" width="4" height="4" fill="currentColor" opacity="0.7"/>
          <rect x="7" y="1" width="4" height="4" fill="currentColor" opacity="0.4"/>
          <rect x="1" y="7" width="4" height="4" fill="currentColor" opacity="0.4"/>
          <rect x="7" y="7" width="4" height="4" fill="currentColor" opacity="0.7"/>
        </svg>
        Pixel
      </button>
    </div>
  );
}
