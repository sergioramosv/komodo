'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModelLeaderboardTable, LeaderboardRow } from '@/components/analytics/model-leaderboard-table';
import { LeaderboardFilters, LeaderboardFiltersState } from '@/components/analytics/leaderboard-filters';

const PROJECT_ID = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('projectId') || '-OmFjaFM9glBQnBTT7QQ'
  : '-OmFjaFM9glBQnBTT7QQ';

function defaultFilters(): LeaderboardFiltersState {
  return { complexity: '', period: 'all' };
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardRow[]>([]);
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

      {!loading && !error && <ModelLeaderboardTable data={data} />}
    </div>
  );
}
