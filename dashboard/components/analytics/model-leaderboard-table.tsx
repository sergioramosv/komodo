'use client';

export interface LeaderboardRow {
  model: string;
  role: string;
  /** null means no review scores exist for this model+role (not a real score of zero) */
  avgScore: number | null;
  avgCycles: number;
  avgDurationMinutes: number;
  avgCost: number;
  taskCount: number;
}

export interface OptimalModel {
  role: string;
  model: string;
  avgScore: number;
  taskCount: number;
  label: string;
}

const ROLE_COLORS: Record<string, string> = {
  planner: 'text-blue-400 bg-blue-950 border-blue-800',
  coder: 'text-green-400 bg-green-950 border-green-800',
  reviewer: 'text-purple-400 bg-purple-950 border-purple-800',
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-neutral-500">—</span>;
  const color =
    score >= 8 ? 'text-green-400' : score >= 6 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-semibold ${color}`}>{score.toFixed(1)}</span>;
}

function isOptimal(row: LeaderboardRow, optimalModels: OptimalModel[]): boolean {
  return optimalModels.some(o => o.model === row.model && o.role === row.role);
}

interface Props {
  data: LeaderboardRow[];
  optimalModels?: OptimalModel[];
}

export function ModelLeaderboardTable({ data, optimalModels = [] }: Props) {
  if (data.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Model Leaderboard</h2>
        <p className="text-xs text-neutral-600">No data yet. Run some tasks to see model performance.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-sm font-medium text-neutral-400">Model Leaderboard</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-xs text-neutral-500">
              <th className="pb-3 pr-4 text-left font-medium">#</th>
              <th className="pb-3 pr-4 text-left font-medium">Model</th>
              <th className="pb-3 pr-4 text-left font-medium">Role</th>
              <th className="pb-3 pr-4 text-right font-medium">Avg Score</th>
              <th className="pb-3 pr-4 text-right font-medium">Avg Cycles</th>
              <th className="pb-3 pr-4 text-right font-medium">Avg Duration</th>
              <th className="pb-3 pr-4 text-right font-medium">Avg Cost</th>
              <th className="pb-3 text-right font-medium">Tasks</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const optimal = isOptimal(row, optimalModels);
              return (
                <tr
                  key={`${row.model}::${row.role}`}
                  className={`border-b border-neutral-800/50 last:border-0 transition-colors ${
                    optimal
                      ? 'bg-yellow-950/30 hover:bg-yellow-950/50 border-l-2 border-l-yellow-500'
                      : 'hover:bg-neutral-800/30'
                  }`}
                >
                  <td className="py-3 pr-4 text-neutral-500">
                    {optimal ? (
                      <span className="text-yellow-400" title="Optimal model for this role">&#9733;</span>
                    ) : (
                      i + 1
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs max-w-48 truncate">
                    <span className={optimal ? 'text-yellow-200 font-semibold' : 'text-neutral-200'}>
                      {row.model}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium capitalize ${
                        ROLE_COLORS[row.role] || 'text-neutral-400 bg-neutral-800 border-neutral-700'
                      }`}
                    >
                      {row.role}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <ScoreBadge score={row.avgScore} />
                  </td>
                  <td className="py-3 pr-4 text-right text-neutral-300">
                    {row.avgCycles.toFixed(1)}
                  </td>
                  <td className="py-3 pr-4 text-right text-neutral-300">
                    {row.avgDurationMinutes >= 60
                      ? `${(row.avgDurationMinutes / 60).toFixed(1)}h`
                      : `${row.avgDurationMinutes.toFixed(0)}m`}
                  </td>
                  <td className="py-3 pr-4 text-right text-neutral-300">
                    ${row.avgCost.toFixed(3)}
                  </td>
                  <td className="py-3 text-right text-neutral-500">{row.taskCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
