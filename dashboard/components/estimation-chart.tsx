'use client';

import { useEffect, useState } from 'react';

interface ChartDataPoint {
  taskId: string;
  estimatedDevPoints: number;
  actualDurationMinutes: number;
  reviewCycles: number;
  filesCount: number;
  model: string;
  completedAt: string;
}

interface RangeStats {
  taskCount: number;
  avgDuration: number;
  avgReviewCycles: number;
  avgFilesChanged: number;
  avgDevPoints: number;
}

interface Warning {
  range: string;
  avgReviewCycles: number;
  message: string;
}

interface EstimationData {
  metrics: ChartDataPoint[];
  ratios: Record<string, RangeStats | null>;
  warnings: Warning[];
  totalTasks: number;
}

const RANGE_COLORS: Record<string, string> = {
  trivial: 'bg-green-500',
  standard: 'bg-blue-500',
  complex: 'bg-purple-500',
};

const RANGE_LABELS: Record<string, string> = {
  trivial: '1-2 pts',
  standard: '3-5 pts',
  complex: '8+ pts',
};

function BarGroup({ label, stats }: { label: string; stats: RangeStats }) {
  const maxCycles = 10;
  const cycleWidth = Math.min((stats.avgReviewCycles / maxCycles) * 100, 100);
  const maxDuration = 60;
  const durationWidth = Math.min((stats.avgDuration / 60 / maxDuration) * 100, 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-500">{stats.taskCount} tasks</span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] text-neutral-500">Cycles</span>
          <div className="flex-1 h-3 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${cycleWidth}%` }}
            />
          </div>
          <span className="w-8 text-right text-[10px] text-neutral-400">
            {stats.avgReviewCycles.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] text-neutral-500">Duration</span>
          <div className="flex-1 h-3 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan-500 transition-all"
              style={{ width: `${durationWidth}%` }}
            />
          </div>
          <span className="w-8 text-right text-[10px] text-neutral-400">
            {(stats.avgDuration / 60).toFixed(0)}m
          </span>
        </div>
      </div>
    </div>
  );
}

export function EstimationChart({ projectId }: { projectId: string }) {
  const [data, setData] = useState<EstimationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/projects/${projectId}/estimation-metrics`);
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
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Estimation vs Reality</h2>
        <p className="text-xs text-neutral-600">Loading...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Estimation vs Reality</h2>
        <p className="text-xs text-red-400">{error}</p>
      </section>
    );
  }

  if (!data || data.totalTasks === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Estimation vs Reality</h2>
        <p className="text-xs text-neutral-600">No completed tasks with metrics yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-400">Estimation vs Reality</h2>
        <span className="text-xs text-neutral-600">{data.totalTasks} tasks tracked</span>
      </div>

      {/* Scatter dots: estimation vs review cycles */}
      <div className="mb-4 flex items-end gap-1 h-24">
        {data.metrics.map((point) => {
          const pts = point.estimatedDevPoints;
          const color =
            pts <= 2 ? 'bg-green-500' : pts <= 5 ? 'bg-blue-500' : 'bg-purple-500';
          const height = Math.min(Math.max(point.reviewCycles * 20, 8), 96);

          return (
            <div
              key={point.taskId}
              className="flex flex-col items-center justify-end flex-1 min-w-0"
              title={`${point.estimatedDevPoints}pts - ${point.reviewCycles} cycles - ${point.actualDurationMinutes}min`}
            >
              <div
                className={`w-full max-w-[12px] rounded-sm ${color} opacity-70 hover:opacity-100 transition-opacity`}
                style={{ height: `${height}px` }}
              />
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mb-4 flex gap-3">
        {Object.entries(RANGE_COLORS).map(([range, color]) => (
          <div key={range} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
            <span className="text-[10px] text-neutral-500">{RANGE_LABELS[range]}</span>
          </div>
        ))}
      </div>

      {/* Ratio bars by range */}
      <div className="space-y-3">
        {Object.entries(data.ratios).map(([range, stats]) => {
          if (!stats) return null;
          return (
            <BarGroup
              key={range}
              label={`${range.charAt(0).toUpperCase() + range.slice(1)} (${RANGE_LABELS[range]})`}
              stats={stats}
            />
          );
        })}
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="mt-4 space-y-1">
          {data.warnings.map((w) => (
            <div
              key={w.range}
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400"
            >
              {w.message}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
