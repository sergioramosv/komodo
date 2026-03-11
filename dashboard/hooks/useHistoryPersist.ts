'use client';

import { useEffect, useRef } from 'react';
import type { DashboardEvent } from '@/lib/types';

/** Events that should be saved to history. */
const TRACKED = new Set([
  'task:started',
  'task:completed',
  'pr:created',
  'pr:merged',
  'review:cycle:end',
  'fix:applied',
  'sonar:analysis:complete',
]);

/**
 * Watches the event stream and persists tracked events to Firebase via API.
 * Deduplicates by event id to avoid double-writes on reconnection.
 */
export function useHistoryPersist(events: DashboardEvent[]) {
  const persisted = useRef(new Set<string>());

  useEffect(() => {
    if (events.length === 0) return;

    const latest = events[events.length - 1];
    if (!latest || !TRACKED.has(latest.type) || persisted.current.has(latest.id)) return;

    persisted.current.add(latest.id);

    const meta = (latest.metadata || {}) as Record<string, unknown>;

    const body = {
      action: latest.type,
      timestamp: latest.timestamp,
      agent: latest.agentName || meta.agentName || null,
      taskId: meta.taskId || meta.taskDetails?.id || null,
      taskTitle: meta.taskTitle || meta.taskDetails?.title || null,
      prNumber: meta.prNumber || null,
      repo: meta.repo || null,
      metadata: {
        verdict: meta.verdict,
        cycle: meta.cycle,
        branchName: meta.branchName,
        devPoints: meta.devPoints,
        qualityGate: meta.qualityGate,
        ...meta,
      },
    };

    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      // Silent fail — don't block the UI
      persisted.current.delete(latest.id);
    });
  }, [events]);
}
