'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

interface DurationByComplexity {
  complexity: string;
  avgMinutes: number;
  taskCount: number;
}

const COLORS: Record<string, string> = {
  trivial: '#22c55e',
  standard: '#3b82f6',
  complex: '#f59e0b',
  unknown: '#6b7280',
};

export function DurationComplexityChart({ data }: { data: DurationByComplexity[] }) {
  if (data.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Avg Duration by Complexity</h2>
        <p className="text-xs text-neutral-600">No data yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-sm font-medium text-neutral-400">Avg Duration by Complexity</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="complexity" tick={{ fill: '#999', fontSize: 12 }} />
            <YAxis tick={{ fill: '#999', fontSize: 12 }} label={{ value: 'minutes', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
              labelStyle={{ color: '#ccc' }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, _name: any, props: any) => [
                `${value} min (${props?.payload?.taskCount ?? 0} tasks)`,
                'Avg Duration',
              ]}
            />
            <Bar dataKey="avgMinutes" name="Avg Duration" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.complexity} fill={COLORS[entry.complexity] || '#6b7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
