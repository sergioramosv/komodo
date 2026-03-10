'use client';

import type { MultiProjectState, BudgetState } from '@/lib/types';

interface MultiProjectOverviewProps {
  multiProject: MultiProjectState;
  selectedProject: string | null;
  budget?: BudgetState;
  totalCost: number;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-800">
      <div
        className={`h-1.5 rounded-full transition-all ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function MultiProjectOverview({ multiProject, selectedProject, budget, totalCost }: MultiProjectOverviewProps) {
  const { projects, perProject, activeProject } = multiProject;

  // Aggregated stats
  const totalCompleted = Object.values(perProject).reduce((sum, p) => sum + p.tasksCompleted, 0);
  const totalFailed = Object.values(perProject).reduce((sum, p) => sum + p.tasksFailed, 0);
  const totalDailySpent = Object.values(perProject).reduce((sum, p) => sum + p.dailySpent, 0);

  // If a specific project is selected, show only its details
  if (selectedProject) {
    const stats = perProject[selectedProject];
    if (!stats) {
      return (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <p className="text-neutral-500">No data available for {selectedProject}</p>
        </section>
      );
    }

    const isActive = activeProject === selectedProject;

    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-neutral-400">
            Project: <span className="text-white">{selectedProject}</span>
          </h2>
          {isActive && (
            <span className="flex items-center gap-1.5 rounded bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Active
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-neutral-500 mb-1">Completed</p>
            <p className="text-xl font-bold tabular-nums text-green-400">{stats.tasksCompleted}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500 mb-1">Failed</p>
            <p className="text-xl font-bold tabular-nums text-red-400">{stats.tasksFailed}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500 mb-1">Daily Spent</p>
            <p className="text-xl font-bold tabular-nums">${stats.dailySpent.toFixed(2)}</p>
          </div>
        </div>

        {/* Per-project budget bar */}
        {budget && budget.dailyBudget > 0 && (
          <div className="mt-4 space-y-1">
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Budget usage</span>
              <span>${stats.dailySpent.toFixed(2)} / ${budget.dailyBudget.toFixed(2)}</span>
            </div>
            <ProgressBar
              value={stats.dailySpent}
              max={budget.dailyBudget}
              color={
                stats.dailySpent / budget.dailyBudget >= 1
                  ? 'bg-red-500'
                  : stats.dailySpent / budget.dailyBudget >= 0.8
                    ? 'bg-amber-400'
                    : 'bg-emerald-500'
              }
            />
          </div>
        )}
      </section>
    );
  }

  // Aggregated view (all projects)
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-sm font-medium text-neutral-400 mb-4">All Projects Overview</h2>

      {/* Global stats */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <div>
          <p className="text-xs text-neutral-500 mb-1">Projects</p>
          <p className="text-xl font-bold tabular-nums">{projects.length}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500 mb-1">Completed</p>
          <p className="text-xl font-bold tabular-nums text-green-400">{totalCompleted}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500 mb-1">Failed</p>
          <p className="text-xl font-bold tabular-nums text-red-400">{totalFailed}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500 mb-1">Total Spent</p>
          <p className="text-xl font-bold tabular-nums">${totalDailySpent.toFixed(2)}</p>
        </div>
      </div>

      {/* Per-project breakdown */}
      <div className="space-y-3">
        {projects.map((projectId) => {
          const stats = perProject[projectId] || { tasksCompleted: 0, tasksFailed: 0, dailySpent: 0 };
          const isActive = activeProject === projectId;
          const costShare = totalDailySpent > 0 ? (stats.dailySpent / totalDailySpent) * 100 : 0;

          return (
            <div key={projectId} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {isActive && (
                    <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                  )}
                  <span className="text-sm font-medium text-neutral-200">{projectId}</span>
                </div>
                <span className="text-xs text-neutral-500">
                  ${stats.dailySpent.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center gap-4 text-xs text-neutral-400">
                <span className="text-green-400">{stats.tasksCompleted} done</span>
                {stats.tasksFailed > 0 && (
                  <span className="text-red-400">{stats.tasksFailed} failed</span>
                )}
              </div>

              {/* Cost share bar */}
              <div className="mt-2">
                <ProgressBar
                  value={costShare}
                  max={100}
                  color={isActive ? 'bg-violet-500' : 'bg-neutral-600'}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Global budget tracking */}
      {budget && (budget.dailyBudget > 0 || budget.weeklyBudget > 0) && (
        <div className="mt-4 pt-4 border-t border-neutral-800">
          <h3 className="text-xs font-medium text-neutral-400 mb-2">Global Budget</h3>
          <div className="space-y-2">
            {budget.dailyBudget > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>Daily</span>
                  <span>${budget.dailySpent.toFixed(2)} / ${budget.dailyBudget.toFixed(2)}</span>
                </div>
                <ProgressBar
                  value={budget.dailySpent}
                  max={budget.dailyBudget}
                  color={
                    budget.dailySpent / budget.dailyBudget >= 1
                      ? 'bg-red-500'
                      : budget.dailySpent / budget.dailyBudget >= 0.8
                        ? 'bg-amber-400'
                        : 'bg-emerald-500'
                  }
                />
              </div>
            )}
            {budget.weeklyBudget > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>Weekly</span>
                  <span>${budget.weeklySpent.toFixed(2)} / ${budget.weeklyBudget.toFixed(2)}</span>
                </div>
                <ProgressBar
                  value={budget.weeklySpent}
                  max={budget.weeklyBudget}
                  color={
                    budget.weeklySpent / budget.weeklyBudget >= 1
                      ? 'bg-red-500'
                      : budget.weeklySpent / budget.weeklyBudget >= 0.8
                        ? 'bg-amber-400'
                        : 'bg-emerald-500'
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
