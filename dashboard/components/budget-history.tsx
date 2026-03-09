'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface DailyCostEntry {
  date: string;
  totalCost: number;
}

interface BudgetHistoryProps {
  projectId: string;
  dailyBudget?: number;
}

export function BudgetHistory({ projectId, dailyBudget }: BudgetHistoryProps) {
  const [history, setHistory] = useState<DailyCostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/budget-history`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setHistory(json.history ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Daily Cost History</h2>
        <p className="text-xs text-neutral-600">Loading...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Daily Cost History</h2>
        <p className="text-xs text-red-400">{error}</p>
      </section>
    );
  }

  if (history.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Daily Cost History</h2>
        <p className="text-xs text-neutral-600">No cost history yet.</p>
      </section>
    );
  }

  const totalPeriod = history.reduce((s, d) => s + d.totalCost, 0);
  const avgDaily = totalPeriod / history.length;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-neutral-400">Daily Cost History (last 30 days)</h2>
        <div className="flex gap-4 text-xs text-neutral-500">
          <span>Total: <span className="text-neutral-300">${totalPeriod.toFixed(2)}</span></span>
          <span>Avg/day: <span className="text-neutral-300">${avgDaily.toFixed(2)}</span></span>
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickFormatter={(v: string) => v.slice(5)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickFormatter={(v: number) => `$${v.toFixed(1)}`}
              width={45}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#171717', border: '1px solid #333', borderRadius: 6 }}
              labelStyle={{ color: '#ccc', fontSize: 11 }}
              formatter={(value: number) => [`$${value.toFixed(3)}`, 'Cost']}
            />
            {dailyBudget && dailyBudget > 0 && (
              <ReferenceLine
                y={dailyBudget}
                stroke="#ef4444"
                strokeDasharray="4 4"
                label={{ value: 'Budget', fill: '#ef4444', fontSize: 10, position: 'right' }}
              />
            )}
            <Area
              type="monotone"
              dataKey="totalCost"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#costGradient)"
              dot={{ r: 2, fill: '#f59e0b' }}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
