'use client';

import { useEffect, useState } from 'react';
import type { CoverageEntry } from '@/types/coverage';

interface CoverageTrendData {
  history: CoverageEntry[];
  current: number | null;
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const width = Math.min((value / max) * 100, 100);
  const color =
    value >= 80 ? 'bg-green-500' : value >= 60 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex-1 h-4 rounded-full bg-neutral-800 overflow-hidden">
      <div
        className={`h-full rounded-full ${color} transition-all`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function CoverageTrend({ projectId }: { projectId: string }) {
  const [data, setData] = useState<CoverageTrendData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/projects/${projectId}/coverage-trend`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [projectId]);

  if (loading) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Coverage Trend</h2>
        <p className="text-xs text-neutral-600">Loading...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Coverage Trend</h2>
        <p className="text-xs text-red-400">{error}</p>
      </section>
    );
  }

  if (!data || data.history.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Coverage Trend</h2>
        <p className="text-xs text-neutral-600">No coverage data yet.</p>
      </section>
    );
  }

  const { history, current } = data;
  const maxCoverage = 100;

  // Calculate overall trend
  const first = history[0].coverage;
  const last = history[history.length - 1].coverage;
  const overallDelta = parseFloat((last - first).toFixed(2));
  const trendSign = overallDelta >= 0 ? '+' : '';
  const trendColor = overallDelta > 0 ? 'text-green-400' : overallDelta < 0 ? 'text-red-400' : 'text-neutral-400';

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-400">Coverage Trend</h2>
        <div className="flex items-center gap-2">
          {current !== null && (
            <span className="text-lg font-bold tabular-nums">{current}%</span>
          )}
          <span className={`text-xs font-medium ${trendColor}`}>
            {trendSign}{overallDelta}%
          </span>
        </div>
      </div>

      {/* Sparkline-style bar chart */}
      <div className="mb-3 flex items-end gap-0.5 h-20">
        {history.map((entry, i) => {
          const height = Math.max((entry.coverage / maxCoverage) * 80, 4);
          const color =
            entry.coverage >= 80
              ? 'bg-green-500'
              : entry.coverage >= 60
                ? 'bg-amber-500'
                : 'bg-red-500';
          const isLast = i === history.length - 1;

          return (
            <div
              key={`${entry.timestamp}-${i}`}
              className="flex flex-col items-center justify-end flex-1 min-w-0"
              title={`${entry.coverage}% — ${new Date(entry.timestamp).toLocaleDateString()}${entry.delta !== null ? ` (${entry.delta >= 0 ? '+' : ''}${entry.delta}%)` : ''}`}
            >
              <div
                className={`w-full max-w-[14px] rounded-sm ${color} ${isLast ? 'opacity-100' : 'opacity-60'} hover:opacity-100 transition-opacity`}
                style={{ height: `${height}px` }}
              />
            </div>
          );
        })}
      </div>

      {/* Recent entries list */}
      <div className="space-y-1.5">
        {history.slice(-5).reverse().map((entry, i) => {
          const deltaStr = entry.delta !== null
            ? `${entry.delta >= 0 ? '+' : ''}${entry.delta}%`
            : 'baseline';
          const deltaColor = entry.delta !== null
            ? entry.delta > 0 ? 'text-green-400' : entry.delta < 0 ? 'text-red-400' : 'text-neutral-500'
            : 'text-neutral-500';

          return (
            <div key={`${entry.timestamp}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="text-neutral-600 tabular-nums w-16 shrink-0">
                {new Date(entry.timestamp).toLocaleDateString()}
              </span>
              <MiniBar value={entry.coverage} max={maxCoverage} />
              <span className="tabular-nums w-12 text-right text-neutral-300">{entry.coverage}%</span>
              <span className={`tabular-nums w-12 text-right ${deltaColor}`}>{deltaStr}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
