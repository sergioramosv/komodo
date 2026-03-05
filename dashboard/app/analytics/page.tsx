'use client';

import { useEffect, useState, useCallback } from 'react';
import { VelocityChart } from '@/components/analytics/velocity-chart';
import { CostChart } from '@/components/analytics/cost-chart';
import { ReviewPassRateChart } from '@/components/analytics/review-pass-rate-chart';
import { DurationComplexityChart } from '@/components/analytics/duration-complexity-chart';
import { ModelUsageChart } from '@/components/analytics/model-usage-chart';
import { AnalyticsFilters } from '@/components/analytics/analytics-filters';

interface FiltersState {
  startDate: string;
  endDate: string;
  sprint: string;
  model: string;
  complexity: string;
}

interface AnalyticsData {
  velocity: { sprint: string; tasksCompleted: number; devPoints: number }[];
  costPerSprint: { sprint: string; totalCost: number; taskCount: number; avgCostPerTask: number }[];
  reviewPassRate: { sprint: string; total: number; passedFirst: number; rate: number }[];
  durationByComplexity: { complexity: string; avgMinutes: number; taskCount: number }[];
  modelUsage: { model: string; count: number; avgScore: number }[];
  filters: { sprints: string[]; models: string[] };
  totalEvents: number;
}

const PROJECT_ID = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('projectId') || '-OmFjaFM9glBQnBTT7QQ'
  : '-OmFjaFM9glBQnBTT7QQ';

function defaultFilters(): FiltersState {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    sprint: '',
    model: '',
    complexity: '',
  };
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.sprint) params.set('sprint', filters.sprint);
      if (filters.model) params.set('model', filters.model);
      if (filters.complexity) params.set('complexity', filters.complexity);

      const res = await fetch(`/api/projects/${PROJECT_ID}/analytics?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analytics</h1>
        {data && (
          <span className="text-xs text-neutral-500">
            {data.totalEvents} events ({data.filters.sprints.length} sprints)
          </span>
        )}
      </div>

      <AnalyticsFilters
        filters={filters}
        onChange={setFilters}
        availableSprints={data?.filters.sprints || []}
        availableModels={data?.filters.models || []}
      />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-neutral-500">Loading analytics...</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <VelocityChart data={data.velocity} />
            <CostChart data={data.costPerSprint} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ReviewPassRateChart data={data.reviewPassRate} />
            <DurationComplexityChart data={data.durationByComplexity} />
          </div>

          <ModelUsageChart data={data.modelUsage} />
        </>
      )}
    </div>
  );
}
