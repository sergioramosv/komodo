'use client';

export interface LeaderboardFiltersState {
  complexity: string;
  period: string;
}

interface LeaderboardFiltersProps {
  filters: LeaderboardFiltersState;
  onChange: (filters: LeaderboardFiltersState) => void;
}

export function LeaderboardFilters({ filters, onChange }: LeaderboardFiltersProps) {
  function update(key: keyof LeaderboardFiltersState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">Complexity</label>
        <select
          value={filters.complexity}
          onChange={(e) => update('complexity', e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="">All</option>
          <option value="trivial">Trivial (1-2 pts)</option>
          <option value="standard">Standard (3-5 pts)</option>
          <option value="complex">Complex (8+ pts)</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">Period</label>
        <select
          value={filters.period}
          onChange={(e) => update('period', e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="all">All time</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
        </select>
      </div>
    </div>
  );
}
