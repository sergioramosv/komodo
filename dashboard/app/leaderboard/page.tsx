'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModelLeaderboardTable, LeaderboardRow, OptimalModel } from '@/components/analytics/model-leaderboard-table';
import { LeaderboardFilters, LeaderboardFiltersState } from '@/components/analytics/leaderboard-filters';

interface ModelRecommendation {
  role: string;
  currentDefault: string;
  currentAvgScore: number;
  currentAvgCost: number;
  recommended: string;
  recommendedAvgScore: number;
  recommendedAvgCost: number;
  savingsPercent: number;
  message: string;
}

const PROJECT_ID = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('projectId') || '-OmFjaFM9glBQnBTT7QQ'
  : '-OmFjaFM9glBQnBTT7QQ';

function defaultFilters(): LeaderboardFiltersState {
  return { complexity: '', period: 'all' };
}

function OptimalModelHighlights({ optimalModels }: { optimalModels: OptimalModel[] }) {
  if (optimalModels.length === 0) return null;

  return (
    <section className="rounded-lg border border-yellow-800/50 bg-yellow-950/20 p-4">
      <h2 className="mb-3 text-sm font-medium text-yellow-400">Optimal Models</h2>
      <div className="flex flex-wrap gap-3">
        {optimalModels.map((o) => (
          <div
            key={o.role}
            className="rounded-md border border-yellow-800/40 bg-yellow-950/30 px-3 py-2"
          >
            <p className="text-sm text-yellow-200">{o.label}</p>
            <p className="mt-0.5 text-xs text-yellow-600">{o.taskCount} tasks evaluated</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecommendationCards({ recommendations }: { recommendations: ModelRecommendation[] }) {
  if (recommendations.length === 0) return null;

  return (
    <section className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-4">
      <h2 className="mb-3 text-sm font-medium text-emerald-400">Cost Optimization Suggestions</h2>
      <div className="space-y-2">
        {recommendations.map((r) => (
          <div
            key={r.role}
            className="rounded-md border border-emerald-800/40 bg-emerald-950/30 px-3 py-2"
          >
            <p className="text-sm text-emerald-200">{r.message}</p>
            <div className="mt-1 flex gap-4 text-xs text-emerald-600">
              <span>{r.recommended}: ${r.recommendedAvgCost.toFixed(3)}/task</span>
              <span>vs {r.currentDefault}: ${r.currentAvgCost.toFixed(3)}/task</span>
              <span className="text-emerald-400 font-medium">{r.savingsPercent}% savings</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardRow[]>([]);
  const [optimalModels, setOptimalModels] = useState<OptimalModel[]>([]);
  const [recommendations, setRecommendations] = useState<ModelRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeaderboardFiltersState>(defaultFilters);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.complexity) params.set('complexity', filters.complexity);
      if (filters.period !== 'all') params.set('period', filters.period);

      const res = await fetch(`/api/projects/${PROJECT_ID}/model-leaderboard?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.leaderboard || []);
      setOptimalModels(json.optimalModels || []);
      setRecommendations(json.recommendations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
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
        <h1 className="text-2xl font-bold">Model Leaderboard</h1>
        {!loading && !error && (
          <span className="text-xs text-neutral-500">{data.length} entries</span>
        )}
      </div>

      <LeaderboardFilters filters={filters} onChange={setFilters} />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-neutral-500">Loading leaderboard...</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          <OptimalModelHighlights optimalModels={optimalModels} />
          <RecommendationCards recommendations={recommendations} />
          <ModelLeaderboardTable data={data} optimalModels={optimalModels} />
        </>
      )}
    </div>
  );
}
