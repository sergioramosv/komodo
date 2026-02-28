'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import type { Pattern, PatternType, Severity, MemoryStore } from '@/lib/memory-types';

const TYPE_LABELS: Record<PatternType, string> = {
  error: 'Error',
  'anti-pattern': 'Anti-pattern',
  style: 'Style',
  positive: 'Positive',
};

const TYPE_COLORS: Record<PatternType, string> = {
  error: 'bg-red-500/20 text-red-400',
  'anti-pattern': 'bg-orange-500/20 text-orange-400',
  style: 'bg-blue-500/20 text-blue-400',
  positive: 'bg-green-500/20 text-green-400',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-neutral-700 text-neutral-300',
};

const BAR_COLORS: Record<PatternType, string> = {
  error: 'bg-red-500',
  'anti-pattern': 'bg-orange-500',
  style: 'bg-blue-500',
  positive: 'bg-green-500',
};

export default function MemoryPage() {
  const [store, setStore] = useState<MemoryStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<PatternType | 'all'>('all');
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/memory');
      const data: MemoryStore = await res.json();
      setStore(data);
    } catch {
      setStore({ patterns: [], reviewOutcomes: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemory();
  }, [fetchMemory]);

  const filteredPatterns = useMemo(() => {
    if (!store) return [];
    let result = [...store.patterns];
    if (filterType !== 'all') {
      result = result.filter((p) => p.type === filterType);
    }
    if (filterSeverity !== 'all') {
      result = result.filter((p) => p.severity === filterSeverity);
    }
    result.sort((a, b) => b.frequency - a.frequency);
    return result;
  }, [store, filterType, filterSeverity]);

  const top10 = useMemo(() => {
    if (!store) return [];
    return [...store.patterns]
      .filter((p) => p.type === 'error' || p.type === 'anti-pattern')
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
  }, [store]);

  const stats = useMemo(() => {
    if (!store) return null;
    const outcomes = store.reviewOutcomes;
    const totalReviews = outcomes.length;
    if (totalReviews === 0) {
      return { totalReviews: 0, passed: 0, failed: 0, passRate: 0, avgCycles: 0, trend: null };
    }
    const passed = outcomes.filter((r) => r.outcome === 'passed').length;
    const failed = outcomes.filter((r) => r.outcome === 'failed').length;
    const passRate = Math.round((passed / totalReviews) * 100);
    const totalCycles = outcomes.reduce((sum, r) => sum + (r.cycles || 1), 0);
    const avgCycles = Math.round((totalCycles / totalReviews) * 10) / 10;

    // Trend: compare avg cycles of first half vs second half
    let trend: 'improving' | 'stable' | 'worsening' | null = null;
    if (outcomes.length >= 4) {
      const mid = Math.floor(outcomes.length / 2);
      const firstHalf = outcomes.slice(0, mid);
      const secondHalf = outcomes.slice(mid);
      const avgFirst = firstHalf.reduce((s, r) => s + r.cycles, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((s, r) => s + r.cycles, 0) / secondHalf.length;
      if (avgSecond < avgFirst - 0.2) trend = 'improving';
      else if (avgSecond > avgFirst + 0.2) trend = 'worsening';
      else trend = 'stable';
    }

    return { totalReviews, passed, failed, passRate, avgCycles, trend };
  }, [store]);

  const patternCounts = useMemo(() => {
    if (!store) return { error: 0, 'anti-pattern': 0, style: 0, positive: 0 };
    const counts: Record<string, number> = { error: 0, 'anti-pattern': 0, style: 0, positive: 0 };
    store.patterns.forEach((p) => {
      counts[p.type] = (counts[p.type] || 0) + 1;
    });
    return counts;
  }, [store]);

  async function handleClear() {
    setClearing(true);
    try {
      const res = await fetch('/api/memory/clear', { method: 'DELETE' });
      if (res.ok) {
        setStore({ patterns: [], reviewOutcomes: [] });
      }
    } catch {
      // silently fail
    } finally {
      setClearing(false);
      setShowClearConfirm(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Memory</h1>
        <p className="text-neutral-500">Loading patterns...</p>
      </div>
    );
  }

  const maxFreq = top10.length > 0 ? top10[0].frequency : 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Memory</h1>
        {showClearConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-400">Clear all memory?</span>
            <button
              onClick={handleClear}
              disabled={clearing}
              className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {clearing ? 'Clearing...' : 'Confirm'}
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="rounded bg-neutral-700 px-3 py-1 text-sm font-medium text-neutral-300 hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-300 hover:bg-neutral-700"
          >
            Clear Memory
          </button>
        )}
      </div>

      {/* Stats Cards */}
      {stats && (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="text-sm font-medium text-neutral-400">Total Patterns</h3>
            <p className="mt-1 text-2xl font-bold">{store?.patterns.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="text-sm font-medium text-neutral-400">Total Reviews</h3>
            <p className="mt-1 text-2xl font-bold">{stats.totalReviews}</p>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="text-sm font-medium text-neutral-400">Avg Review Cycles</h3>
            <p className="mt-1 text-2xl font-bold">{stats.avgCycles || '—'}</p>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="text-sm font-medium text-neutral-400">Trend</h3>
            <p className="mt-1 text-2xl font-bold">
              {stats.trend === 'improving' && <span className="text-green-400">Improving</span>}
              {stats.trend === 'worsening' && <span className="text-red-400">Worsening</span>}
              {stats.trend === 'stable' && <span className="text-yellow-400">Stable</span>}
              {stats.trend === null && <span className="text-neutral-500">—</span>}
            </p>
          </div>
        </section>
      )}

      {/* Pattern Type Distribution */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(Object.keys(TYPE_LABELS) as PatternType[]).map((type) => (
          <div key={type} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h3 className="text-sm font-medium text-neutral-400">{TYPE_LABELS[type]}</h3>
            <p className="mt-1 text-2xl font-bold">{patternCounts[type]}</p>
          </div>
        ))}
      </section>

      {/* Top 10 Bar Chart */}
      {top10.length > 0 && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-4 text-lg font-semibold">Top 10 Most Frequent Issues</h2>
          <div className="space-y-3">
            {top10.map((pattern) => (
              <div key={pattern.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate pr-4 text-neutral-300" title={pattern.description}>
                    {pattern.description.length > 80
                      ? pattern.description.slice(0, 80) + '...'
                      : pattern.description}
                  </span>
                  <span className="shrink-0 text-neutral-400">x{pattern.frequency}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-neutral-800">
                  <div
                    className={`h-2 rounded-full ${BAR_COLORS[pattern.type]}`}
                    style={{ width: `${(pattern.frequency / maxFreq) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-neutral-400">Type:</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as PatternType | 'all')}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
          >
            <option value="all">All</option>
            {(Object.keys(TYPE_LABELS) as PatternType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-neutral-400">Severity:</label>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value as Severity | 'all')}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
          >
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <span className="text-sm text-neutral-500">
          {filteredPatterns.length} pattern{filteredPatterns.length !== 1 ? 's' : ''}
        </span>
      </section>

      {/* Patterns Table */}
      {filteredPatterns.length === 0 ? (
        <p className="text-neutral-500">No patterns found.</p>
      ) : (
        <section className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-800 bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Freq</th>
                <th className="px-4 py-3 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filteredPatterns.map((pattern) => (
                <PatternRow key={pattern.id} pattern={pattern} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function PatternRow({ pattern }: { pattern: Pattern }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="cursor-pointer bg-neutral-950 transition-colors hover:bg-neutral-900"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="max-w-md px-4 py-3 text-neutral-200">
          <span className="mr-1 text-neutral-600">{expanded ? '▾' : '▸'}</span>
          {pattern.description.length > 100
            ? pattern.description.slice(0, 100) + '...'
            : pattern.description}
        </td>
        <td className="px-4 py-3">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[pattern.type]}`}>
            {TYPE_LABELS[pattern.type]}
          </span>
        </td>
        <td className="px-4 py-3">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_COLORS[pattern.severity]}`}
          >
            {pattern.severity}
          </span>
        </td>
        <td className="px-4 py-3 text-neutral-300">x{pattern.frequency}</td>
        <td className="whitespace-nowrap px-4 py-3 text-neutral-400">{pattern.lastSeen}</td>
      </tr>
      {expanded && (
        <tr className="bg-neutral-900/50">
          <td colSpan={5} className="px-4 py-3">
            <div className="space-y-2 text-sm">
              <p className="text-neutral-300">{pattern.description}</p>
              {pattern.resolution && (
                <p className="text-neutral-400">
                  <span className="font-medium text-neutral-300">Resolution: </span>
                  {pattern.resolution}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {pattern.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                First seen: {pattern.firstSeen}
                {pattern.prNumber && <> &middot; PR #{pattern.prNumber}</>}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
