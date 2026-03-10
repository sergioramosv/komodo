'use client';

import { useEffect } from 'react';
import { TaskDetails } from '@/lib/types';

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: TaskDetails;
  currentPR?: string | { number: number; repo: string } | null;
}

export function TaskDetailModal({ isOpen, onClose, task, currentPR }: TaskDetailModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const prLabel = currentPR
    ? typeof currentPR === 'object'
      ? `#${currentPR.number}`
      : currentPR
    : null;

  const prUrl = currentPR && typeof currentPR === 'object' && currentPR.repo
    ? `https://github.com/${currentPR.repo}/pull/${currentPR.number}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-neutral-800 p-5">
          <div className="flex-1 pr-4">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500 mb-1">Task Details</p>
            <h2 className="text-lg font-bold leading-tight">{task.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="mt-1 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 p-5">
          {/* User Story */}
          {task.userStory && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">User Story</p>
              <p className="text-sm leading-relaxed text-neutral-300">{task.userStory}</p>
            </div>
          )}

          {/* Points row */}
          <div className="flex flex-wrap gap-3">
            {task.businessPoints != null && task.businessPoints > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
                <span className="text-amber-400 text-lg">&#128188;</span>
                <div>
                  <p className="text-xs text-amber-400/70">Business Points</p>
                  <p className="text-lg font-bold text-amber-400">{task.businessPoints}</p>
                </div>
              </div>
            )}
            {task.devPoints != null && task.devPoints > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2">
                <span className="text-blue-400 text-lg">&#9881;</span>
                <div>
                  <p className="text-xs text-blue-400/70">Dev Points</p>
                  <p className="text-lg font-bold text-blue-400">{task.devPoints}</p>
                </div>
              </div>
            )}
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            {task.assignedDeveloper && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Developer</p>
                <p className="text-sm font-medium">{task.assignedDeveloper}</p>
              </div>
            )}
            {task.sprint && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Sprint</p>
                <p className="text-sm font-medium">{task.sprint}</p>
              </div>
            )}
            {task.branchName && (
              <div className="col-span-2 rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Branch</p>
                <p className="text-sm font-mono text-neutral-300 truncate">{task.branchName}</p>
              </div>
            )}
            {prLabel && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Pull Request</p>
                {prUrl ? (
                  <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-400 hover:underline">
                    PR {prLabel}
                  </a>
                ) : (
                  <p className="text-sm font-medium">PR {prLabel}</p>
                )}
              </div>
            )}
            {task.id && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Task ID</p>
                <p className="text-sm font-mono text-neutral-400 truncate">{task.id}</p>
              </div>
            )}
          </div>

          {/* Acceptance Criteria */}
          {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Acceptance Criteria</p>
              <ul className="space-y-1.5">
                {task.acceptanceCriteria.map((criterion, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                    <span className="mt-0.5 text-neutral-600">&#9744;</span>
                    {criterion}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
