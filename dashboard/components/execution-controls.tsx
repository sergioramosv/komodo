'use client';

import { useState } from 'react';
import type { ExecutionState } from '@/lib/types';

interface ExecutionControlsProps {
  executionState: ExecutionState;
  phase: string;
  connected: boolean;
  onPause: () => void;
  onStop: () => void;
}

const STATE_CONFIG: Record<ExecutionState, { label: string; dotClass: string; bgClass: string }> = {
  running: { label: 'Running', dotClass: 'bg-green-500', bgClass: 'bg-green-500/10 text-green-400' },
  paused: { label: 'Paused', dotClass: 'bg-yellow-500', bgClass: 'bg-yellow-500/10 text-yellow-400' },
  stopped: { label: 'Stopped', dotClass: 'bg-neutral-500', bgClass: 'bg-neutral-500/10 text-neutral-400' },
};

export function ExecutionControls({
  executionState,
  phase,
  connected,
  onPause,
  onStop,
}: ExecutionControlsProps) {
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const state = executionState ?? 'stopped';
  const config = STATE_CONFIG[state];
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const hasTaskInProgress = phase !== 'idle';

  function handleStop() {
    if (hasTaskInProgress && !showStopConfirm) {
      setShowStopConfirm(true);
      return;
    }
    setShowStopConfirm(false);
    onStop();
  }

  function handleCancelStop() {
    setShowStopConfirm(false);
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-neutral-400">Execution</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bgClass}`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${config.dotClass} ${isRunning ? 'animate-pulse' : ''}`}
            />
            {config.label}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Pause button — visible when running */}
          {isRunning && (
            <button
              onClick={onPause}
              disabled={!connected}
              className="inline-flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-3 py-1.5 text-sm font-medium text-yellow-400 transition-colors hover:bg-yellow-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Pause after current task completes"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Pause
            </button>
          )}

          {/* Stop button — visible when running or paused */}
          {(isRunning || isPaused) && (
            <button
              onClick={handleStop}
              disabled={!connected}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Stop immediately"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Stop confirmation dialog */}
      {showStopConfirm && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm text-red-300">
            A task is currently in progress. Stopping now will interrupt it. Are you sure?
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleStop}
              className="rounded-md bg-red-500/20 px-3 py-1 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
            >
              Confirm Stop
            </button>
            <button
              onClick={handleCancelStop}
              className="rounded-md bg-neutral-800 px-3 py-1 text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Paused info banner */}
      {isPaused && (
        <div className="mt-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
          <p className="text-sm text-yellow-300">
            Orchestrator will pause after the current task completes.
          </p>
        </div>
      )}
    </section>
  );
}
