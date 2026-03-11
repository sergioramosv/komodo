'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Clock,
  Filter,
  Loader2,
  GitPullRequest,
  CheckCircle2,
  PlayCircle,
  GitMerge,
  ShieldCheck,
  Bug,
  ScanSearch,
  ExternalLink,
} from 'lucide-react';
import type { HistoryEntry } from '@/lib/types';

/* ── Action display config ── */

const ACTION_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; bg: string }
> = {
  'task:started': {
    label: 'Task Started',
    icon: <PlayCircle size={16} />,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  'task:completed': {
    label: 'Task Completed',
    icon: <CheckCircle2 size={16} />,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
  },
  'pr:created': {
    label: 'PR Created',
    icon: <GitPullRequest size={16} />,
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
  },
  'pr:merged': {
    label: 'PR Merged',
    icon: <GitMerge size={16} />,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  'review:cycle:end': {
    label: 'Review Done',
    icon: <ShieldCheck size={16} />,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  'fix:applied': {
    label: 'Fix Applied',
    icon: <Bug size={16} />,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
  },
  'sonar:analysis:complete': {
    label: 'Sonar Analysis',
    icon: <ScanSearch size={16} />,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
  },
};

/* ── Preset date ranges ── */

type DatePreset = 'today' | 'week' | 'month' | 'all';

function getDateRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);

  switch (preset) {
    case 'today':
      return { start: end, end };
    case 'week': {
      const w = new Date(now);
      w.setDate(w.getDate() - 7);
      return { start: w.toISOString().slice(0, 10), end };
    }
    case 'month': {
      const m = new Date(now);
      m.setMonth(m.getMonth() - 1);
      return { start: m.toISOString().slice(0, 10), end };
    }
    case 'all':
      return { start: '', end: '' };
  }
}

/* ── Format helpers ── */

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/* ── Page ── */

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [datePreset, setDatePreset] = useState<DatePreset>('week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Task detail modal
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();

      if (datePreset === 'all') {
        if (customStart) params.set('startDate', customStart);
        if (customEnd) params.set('endDate', customEnd);
      } else {
        const { start, end } = getDateRange(datePreset);
        if (start) params.set('startDate', start);
        if (end) params.set('endDate', end);
      }
      if (actionFilter) params.set('action', actionFilter);
      if (agentFilter) params.set('agent', agentFilter);

      const res = await fetch(`/api/history?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [datePreset, customStart, customEnd, actionFilter, agentFilter]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Group entries by date
  const grouped = entries.reduce<Record<string, HistoryEntry[]>>((acc, entry) => {
    const day = formatDate(entry.timestamp);
    if (!acc[day]) acc[day] = [];
    acc[day].push(entry);
    return acc;
  }, {});

  // Unique agents for filter
  const uniqueAgents = [...new Set(entries.map((e) => e.agent).filter(Boolean))] as string[];

  return (
    <div className="mx-auto w-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock size={24} className="text-neutral-400" />
          <h1 className="text-2xl font-bold text-white">History</h1>
          <span className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs text-neutral-400">
            {entries.length} events
          </span>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
            showFilters
              ? 'bg-neutral-700 text-white'
              : 'bg-neutral-800 text-neutral-400 hover:text-white'
          }`}
        >
          <Filter size={14} />
          Filters
        </button>
      </div>

      {/* Date presets */}
      <div className="flex items-center gap-2">
        {(['today', 'week', 'month', 'all'] as DatePreset[]).map((p) => (
          <button
            key={p}
            onClick={() => setDatePreset(p)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              datePreset === p
                ? 'bg-blue-600 text-white'
                : 'bg-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
          </button>
        ))}
      </div>

      {/* Advanced filters */}
      {showFilters && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Start Date</label>
              <input
                type="date"
                value={datePreset === 'all' ? customStart : getDateRange(datePreset).start}
                onChange={(e) => {
                  setDatePreset('all');
                  setCustomStart(e.target.value);
                }}
                className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">End Date</label>
              <input
                type="date"
                value={datePreset === 'all' ? customEnd : getDateRange(datePreset).end}
                onChange={(e) => {
                  setDatePreset('all');
                  setCustomEnd(e.target.value);
                }}
                className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Action</label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white"
              >
                <option value="">All Actions</option>
                {Object.entries(ACTION_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Agent</label>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white"
              >
                <option value="">All Agents</option>
                {uniqueAgents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-neutral-500" />
        </div>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && !error && (
        <div className="py-16 text-center text-neutral-500">
          <Clock size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-lg">No history yet</p>
          <p className="text-sm">Events will appear here as Komodo works on tasks.</p>
        </div>
      )}

      {/* Timeline */}
      {!loading &&
        Object.entries(grouped).map(([day, dayEntries]) => (
          <div key={day}>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-neutral-800" />
              <span className="text-xs font-medium text-neutral-500">{day}</span>
              <div className="h-px flex-1 bg-neutral-800" />
            </div>

            <div className="space-y-2">
              {dayEntries.map((entry) => {
                const cfg = ACTION_CONFIG[entry.action] || {
                  label: entry.action,
                  icon: <Clock size={16} />,
                  color: 'text-neutral-400',
                  bg: 'bg-neutral-500/10',
                };
                const meta = entry.metadata || {};

                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 transition-colors hover:border-neutral-700"
                  >
                    {/* Icon */}
                    <div
                      className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${cfg.bg} ${cfg.color}`}
                    >
                      {cfg.icon}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
                        {entry.agent && (
                          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                            {entry.agent}
                          </span>
                        )}
                        <span className="text-xs text-neutral-600">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </div>

                      {/* Task info */}
                      {entry.taskTitle && (
                        <p className="mt-1 text-sm text-neutral-300">{entry.taskTitle}</p>
                      )}

                      {/* PR info */}
                      {entry.prNumber && (
                        <p className="mt-0.5 text-xs text-neutral-500">
                          PR #{entry.prNumber}
                          {entry.repo ? ` in ${entry.repo}` : ''}
                        </p>
                      )}

                      {/* Review verdict */}
                      {meta.verdict && (
                        <span
                          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${
                            meta.verdict === 'APPROVE'
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-amber-500/10 text-amber-400'
                          }`}
                        >
                          {meta.verdict as string}
                        </span>
                      )}

                      {/* Sonar quality gate */}
                      {meta.qualityGate && (
                        <span className="mt-1 inline-block rounded bg-cyan-500/10 px-1.5 py-0.5 text-xs text-cyan-400">
                          Quality Gate: {meta.qualityGate as string}
                        </span>
                      )}
                    </div>

                    {/* Load task button */}
                    {entry.taskId && (
                      <button
                        onClick={() => setSelectedTaskId(entry.taskId)}
                        className="flex flex-shrink-0 items-center gap-1 rounded-md bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-white"
                        title="Load task details"
                      >
                        <ExternalLink size={12} />
                        Load Task
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {/* Task detail modal (reuse existing) */}
      {selectedTaskId && (
        <TaskModal taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      )}
    </div>
  );
}

/* ── Inline task modal ── */

function TaskModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [task, setTask] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setTask(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [taskId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Task Details</h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white"
          >
            &times;
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-neutral-500" />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {task && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-neutral-500">Title</p>
              <p className="text-sm text-white">{task.title as string}</p>
            </div>

            {task.status && (
              <div>
                <p className="text-xs text-neutral-500">Status</p>
                <span className="inline-block rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                  {task.status as string}
                </span>
              </div>
            )}

            {task.developerName && (
              <div>
                <p className="text-xs text-neutral-500">Developer</p>
                <p className="text-sm text-neutral-300">{task.developerName as string}</p>
              </div>
            )}

            {task.sprintName && (
              <div>
                <p className="text-xs text-neutral-500">Sprint</p>
                <p className="text-sm text-neutral-300">{task.sprintName as string}</p>
              </div>
            )}

            {task.userStory && (
              <div>
                <p className="text-xs text-neutral-500">User Story</p>
                <p className="text-sm text-neutral-300">
                  {typeof task.userStory === 'string'
                    ? task.userStory
                    : `As ${(task.userStory as Record<string, string>).who}, I want ${(task.userStory as Record<string, string>).what}, so that ${(task.userStory as Record<string, string>).why}`}
                </p>
              </div>
            )}

            {task.acceptanceCriteria && Array.isArray(task.acceptanceCriteria) && (
              <div>
                <p className="text-xs text-neutral-500">Acceptance Criteria</p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-neutral-300">
                  {(task.acceptanceCriteria as string[]).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {task.devPoints != null && (
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-neutral-500">Dev Points</p>
                  <p className="text-sm text-white">{task.devPoints as number}</p>
                </div>
                {task.bizPoints != null && (
                  <div>
                    <p className="text-xs text-neutral-500">Biz Points</p>
                    <p className="text-sm text-white">{task.bizPoints as number}</p>
                  </div>
                )}
              </div>
            )}

            {task.branchName && (
              <div>
                <p className="text-xs text-neutral-500">Branch</p>
                <p className="font-mono text-sm text-neutral-300">{task.branchName as string}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
