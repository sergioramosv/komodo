'use client';

interface FiltersState {
  startDate: string;
  endDate: string;
  sprint: string;
  model: string;
  complexity: string;
}

interface AnalyticsFiltersProps {
  filters: FiltersState;
  onChange: (filters: FiltersState) => void;
  availableSprints: string[];
  availableModels: string[];
}

export function AnalyticsFilters({ filters, onChange, availableSprints, availableModels }: AnalyticsFiltersProps) {
  function update(key: keyof FiltersState, value: string) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">From</label>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => update('startDate', e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">To</label>
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => update('endDate', e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">Sprint</label>
        <select
          value={filters.sprint}
          onChange={(e) => update('sprint', e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="">All</option>
          {availableSprints.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">Model</label>
        <select
          value={filters.model}
          onChange={(e) => update('model', e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500"
        >
          <option value="">All</option>
          {availableModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
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
    </div>
  );
}
