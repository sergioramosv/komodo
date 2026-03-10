'use client';

import { useEffect, useState } from 'react';
import { Briefcase, Cog, Star, User, Users, GitBranch, GitPullRequest, Hash, Calendar, IterationCw, X, CheckSquare, Loader2 } from 'lucide-react';
import { TaskDetails } from '@/lib/types';

/* ── Firebase Task shape (from planning-task) ── */
interface UserStory {
  who: string;
  what: string;
  why: string;
}

interface ImplementationPlan {
  status: string;
  approach: string;
  steps: string[];
  dataModelChanges: string;
  apiChanges: string;
  risks: string;
  outOfScope: string;
}

interface FullTask {
  id: string;
  title: string;
  projectId?: string;
  sprintId?: string;
  sprintName?: string | null;
  acceptanceCriteria?: string[];
  userStory?: UserStory | string | null;
  developer?: string;
  developerName?: string;
  coDeveloper?: string;
  coDeveloperName?: string;
  startDate?: string;
  endDate?: string;
  bizPoints?: number;
  devPoints?: number;
  priority?: number;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  implementationPlan?: ImplementationPlan;
  branchName?: string | null;
}

const statusColors: Record<string, string> = {
  'to-do': 'bg-neutral-500/20 text-neutral-300',
  'in-progress': 'bg-blue-500/20 text-blue-400',
  'to-validate': 'bg-yellow-500/20 text-yellow-400',
  'validated': 'bg-green-500/20 text-green-400',
  'done': 'bg-emerald-500/20 text-emerald-400',
};

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: TaskDetails;
  currentPR?: string | { number: number; repo: string } | null;
}

export function TaskDetailModal({ isOpen, onClose, task, currentPR }: TaskDetailModalProps) {
  const [fullTask, setFullTask] = useState<FullTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch full task from Firebase
  useEffect(() => {
    if (!isOpen || !task.id) {
      setFullTask(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/tasks/${encodeURIComponent(task.id)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Task not found (${res.status})`);
        return res.json();
      })
      .then((data) => setFullTask(data))
      .catch((err) => {
        setError(err.message);
        setFullTask(null);
      })
      .finally(() => setLoading(false));
  }, [isOpen, task.id]);

  if (!isOpen) return null;

  // Merge: prefer Firebase data, fall back to event data
  const title = fullTask?.title || task.title;
  const devPoints = fullTask?.devPoints ?? task.devPoints;
  const bizPoints = fullTask?.bizPoints ?? task.businessPoints;
  const developer = fullTask?.developerName || fullTask?.developer || task.assignedDeveloper;
  const coDeveloper = fullTask?.coDeveloperName || fullTask?.coDeveloper;
  const sprint = fullTask?.sprintName || task.sprint;
  const branchName = fullTask?.branchName ?? task.branchName;
  const acceptanceCriteria = fullTask?.acceptanceCriteria || task.acceptanceCriteria || [];
  const status = fullTask?.status;
  const priority = fullTask?.priority;
  const startDate = fullTask?.startDate;
  const endDate = fullTask?.endDate;
  const implementationPlan = fullTask?.implementationPlan;

  // User story can be object {who, what, why} or string
  const userStory = fullTask?.userStory;
  const userStoryIsObject = userStory && typeof userStory === 'object' && 'who' in userStory;

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
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-neutral-800 bg-neutral-900 p-5 rounded-t-xl">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Task Details</p>
              {status && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusColors[status] || 'bg-neutral-600/20 text-neutral-400'}`}>
                  {status}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold leading-tight">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="mt-1 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 p-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 size={16} className="animate-spin text-blue-400" />
              Loading task from Firebase...
            </div>
          )}

          {error && !fullTask && (
            <p className="text-xs text-yellow-500/70">Could not load full task from Firebase. Showing event data.</p>
          )}

          {/* User Story */}
          {userStoryIsObject && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">User Story</p>
              <div className="rounded-lg bg-neutral-800/50 p-4 space-y-2 text-sm leading-relaxed text-neutral-300">
                <p><span className="text-neutral-500">As a</span> {(userStory as UserStory).who}</p>
                <p><span className="text-neutral-500">I want to</span> {(userStory as UserStory).what}</p>
                <p><span className="text-neutral-500">So that</span> {(userStory as UserStory).why}</p>
              </div>
            </div>
          )}
          {!userStoryIsObject && userStory && typeof userStory === 'string' && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">User Story</p>
              <p className="text-sm leading-relaxed text-neutral-300">{userStory}</p>
            </div>
          )}
          {!userStory && task.userStory && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">User Story</p>
              <p className="text-sm leading-relaxed text-neutral-300">{task.userStory}</p>
            </div>
          )}

          {/* Points + Priority */}
          <div className="flex flex-wrap gap-3">
            {bizPoints != null && bizPoints > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
                <Briefcase size={20} className="text-amber-400" />
                <div>
                  <p className="text-xs text-amber-400/70">Business Points</p>
                  <p className="text-lg font-bold text-amber-400">{bizPoints}</p>
                </div>
              </div>
            )}
            {devPoints != null && devPoints > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2">
                <Cog size={20} className="text-blue-400" />
                <div>
                  <p className="text-xs text-blue-400/70">Dev Points</p>
                  <p className="text-lg font-bold text-blue-400">{devPoints}</p>
                </div>
              </div>
            )}
            {priority != null && (
              <div className="flex items-center gap-2 rounded-lg bg-purple-500/10 px-3 py-2">
                <Star size={20} className="text-purple-400" />
                <div>
                  <p className="text-xs text-purple-400/70">Priority</p>
                  <p className="text-lg font-bold text-purple-400">{priority}</p>
                </div>
              </div>
            )}
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            {developer && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Developer</p>
                <p className="text-sm font-medium">{developer}</p>
              </div>
            )}
            {coDeveloper && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Co-Developer</p>
                <p className="text-sm font-medium">{coDeveloper}</p>
              </div>
            )}
            {sprint && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Sprint</p>
                <p className="text-sm font-medium">{sprint}</p>
              </div>
            )}
            {startDate && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Start Date</p>
                <p className="text-sm font-medium">{startDate}</p>
              </div>
            )}
            {endDate && (
              <div className="rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">End Date</p>
                <p className="text-sm font-medium">{endDate}</p>
              </div>
            )}
            {branchName && (
              <div className="col-span-2 rounded-lg bg-neutral-800/50 p-3">
                <p className="text-xs text-neutral-500 mb-0.5">Branch</p>
                <p className="text-sm font-mono text-neutral-300 truncate">{branchName}</p>
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
          {acceptanceCriteria.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Acceptance Criteria</p>
              <ul className="space-y-1.5">
                {acceptanceCriteria.map((criterion, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                    <CheckSquare size={14} className="mt-0.5 text-neutral-600 shrink-0" />
                    {criterion}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Implementation Plan */}
          {implementationPlan && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Implementation Plan</p>
              <div className="space-y-3 rounded-lg bg-neutral-800/50 p-4 text-sm">
                {implementationPlan.approach && (
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Approach</p>
                    <p className="text-neutral-300 whitespace-pre-wrap">{implementationPlan.approach}</p>
                  </div>
                )}
                {implementationPlan.steps && implementationPlan.steps.length > 0 && (
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Steps</p>
                    <ol className="list-decimal list-inside space-y-1 text-neutral-300">
                      {implementationPlan.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {implementationPlan.dataModelChanges && (
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Data Model Changes</p>
                    <p className="text-neutral-300 whitespace-pre-wrap">{implementationPlan.dataModelChanges}</p>
                  </div>
                )}
                {implementationPlan.apiChanges && (
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">API Changes</p>
                    <p className="text-neutral-300 whitespace-pre-wrap">{implementationPlan.apiChanges}</p>
                  </div>
                )}
                {implementationPlan.risks && (
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Risks</p>
                    <p className="text-neutral-300 whitespace-pre-wrap">{implementationPlan.risks}</p>
                  </div>
                )}
                {implementationPlan.outOfScope && (
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Out of Scope</p>
                    <p className="text-neutral-300 whitespace-pre-wrap">{implementationPlan.outOfScope}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
