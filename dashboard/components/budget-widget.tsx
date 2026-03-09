'use client';

import type { BudgetState } from '@/lib/types';

interface BudgetWidgetProps {
  budget: BudgetState;
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

function barColor(pct: number): string {
  if (pct >= 100) return 'bg-red-500';
  if (pct >= 80) return 'bg-amber-400';
  return 'bg-emerald-500';
}

export function BudgetWidget({ budget, totalCost }: BudgetWidgetProps) {
  const { dailySpent, weeklySpent, dailyBudget, weeklyBudget, paused } = budget;

  const dailyPct = dailyBudget > 0 ? (dailySpent / dailyBudget) * 100 : 0;
  const weeklyPct = weeklyBudget > 0 ? (weeklySpent / weeklyBudget) * 100 : 0;

  const hasBudget = dailyBudget > 0 || weeklyBudget > 0;

  return (
    <section className={`rounded-lg border bg-neutral-900 p-5 ${paused ? 'border-red-700' : 'border-neutral-800'}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-neutral-400">Cost & Budget</h2>
        {paused && (
          <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
            Budget paused
          </span>
        )}
      </div>

      {/* Total cost */}
      <p className="text-2xl font-bold tabular-nums mb-4">
        ${totalCost.toFixed(2)}
        <span className="ml-1 text-xs font-normal text-neutral-500">USD total</span>
      </p>

      {hasBudget ? (
        <div className="space-y-3">
          {/* Daily */}
          {dailyBudget > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>Daily</span>
                <span className={dailyPct >= 80 ? (dailyPct >= 100 ? 'text-red-400' : 'text-amber-400') : ''}>
                  ${dailySpent.toFixed(2)} / ${dailyBudget.toFixed(2)}
                  <span className="ml-1 text-neutral-500">({dailyPct.toFixed(0)}%)</span>
                </span>
              </div>
              <ProgressBar value={dailySpent} max={dailyBudget} color={barColor(dailyPct)} />
            </div>
          )}

          {/* Weekly */}
          {weeklyBudget > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>Weekly</span>
                <span className={weeklyPct >= 80 ? (weeklyPct >= 100 ? 'text-red-400' : 'text-amber-400') : ''}>
                  ${weeklySpent.toFixed(2)} / ${weeklyBudget.toFixed(2)}
                  <span className="ml-1 text-neutral-500">({weeklyPct.toFixed(0)}%)</span>
                </span>
              </div>
              <ProgressBar value={weeklySpent} max={weeklyBudget} color={barColor(weeklyPct)} />
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-neutral-600">No budget configured</p>
      )}
    </section>
  );
}
