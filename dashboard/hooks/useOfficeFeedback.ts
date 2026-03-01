'use client';

import { useEffect, useState, useRef } from 'react';
import type { DashboardEvent, KomodoSnapshot } from '@/lib/types';

export interface OfficeFeedback {
  showConfetti: boolean;
  reviewVerdict: { type: 'APPROVED' | 'REQUEST_CHANGES'; cycle: number } | null;
  prNotification: { number: number } | null;
  reviewCycleDisplay: { current: number; max: number } | null;
  sprintProgress: { completed: number; total: number };
}

const CONFETTI_DURATION_MS = 3500;
const VERDICT_DURATION_MS = 4000;
const PR_NOTIFICATION_DURATION_MS = 5000;
const DEFAULT_MAX_REVIEW_CYCLES = 5;

/**
 * Derives visual feedback state from WebSocket events and snapshot.
 * Manages auto-dismiss timers for transient effects (confetti, verdicts, notifications).
 */
export function useOfficeFeedback(
  events: DashboardEvent[],
  snapshot: KomodoSnapshot | null,
): OfficeFeedback {
  const [showConfetti, setShowConfetti] = useState(false);
  const [reviewVerdict, setReviewVerdict] = useState<OfficeFeedback['reviewVerdict']>(null);
  const [prNotification, setPrNotification] = useState<OfficeFeedback['prNotification']>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const confettiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verdictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0]; // events are newest-first
    if (latest.id === lastEventIdRef.current) return;
    lastEventIdRef.current = latest.id;

    // Task completed → confetti
    if (latest.type === 'task:completed') {
      if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current);
      setShowConfetti(true);
      confettiTimerRef.current = setTimeout(() => setShowConfetti(false), CONFETTI_DURATION_MS);
    }

    // Review verdict → green check or red X
    if (latest.type === 'review:cycle:end') {
      const verdict = latest.metadata?.verdict as string | undefined;
      const cycle = (latest.metadata?.cycle as number) ?? 1;
      if (verdict === 'APPROVED' || verdict === 'REQUEST_CHANGES') {
        if (verdictTimerRef.current) clearTimeout(verdictTimerRef.current);
        setReviewVerdict({ type: verdict, cycle });
        verdictTimerRef.current = setTimeout(() => setReviewVerdict(null), VERDICT_DURATION_MS);
      }
    }

    // PR created → floating notification
    if (latest.type === 'pr:created') {
      const prNumber = latest.metadata?.prNumber as number | undefined;
      if (prNumber) {
        if (prTimerRef.current) clearTimeout(prTimerRef.current);
        setPrNotification({ number: prNumber });
        prTimerRef.current = setTimeout(() => setPrNotification(null), PR_NOTIFICATION_DURATION_MS);
      }
    }
  }, [events]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current);
      if (verdictTimerRef.current) clearTimeout(verdictTimerRef.current);
      if (prTimerRef.current) clearTimeout(prTimerRef.current);
    };
  }, []);

  const reviewCycleDisplay = snapshot && snapshot.reviewCycle > 0
    ? { current: snapshot.reviewCycle, max: DEFAULT_MAX_REVIEW_CYCLES }
    : null;

  return {
    showConfetti,
    reviewVerdict,
    prNotification,
    reviewCycleDisplay,
    sprintProgress: {
      completed: snapshot?.tasksCompleted ?? 0,
      total: snapshot?.totalTasks ?? 0,
    },
  };
}
