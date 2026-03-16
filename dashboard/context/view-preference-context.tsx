'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

export type ViewType = '3d' | 'pixel';

interface ViewPreferenceContextValue {
  view: ViewType;
  setView: (v: ViewType) => void;
}

const ViewPreferenceContext = createContext<ViewPreferenceContextValue | null>(null);

const STORAGE_KEY = 'komodo-office-view';

export function ViewPreferenceProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<ViewType>(() => {
    if (typeof window === 'undefined') return '3d';
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === '3d' || stored === 'pixel' ? stored : '3d';
  });

  function setView(v: ViewType) {
    setViewState(v);
    localStorage.setItem(STORAGE_KEY, v);
  }

  return (
    <ViewPreferenceContext.Provider value={{ view, setView }}>
      {children}
    </ViewPreferenceContext.Provider>
  );
}

export function useViewPreference(): ViewPreferenceContextValue {
  const ctx = useContext(ViewPreferenceContext);
  if (!ctx) throw new Error('useViewPreference must be used within ViewPreferenceProvider');
  return ctx;
}
