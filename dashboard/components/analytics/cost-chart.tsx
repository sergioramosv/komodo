'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Line, ComposedChart,
} from 'recharts';

interface SprintCost {
  sprint: string;
  totalCost: number;
  taskCount: number;
  avgCostPerTask: number;
}

export function CostChart({ data }: { data: SprintCost[] }) {
  if (data.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Cost per Sprint</h2>
        <p className="text-xs text-neutral-600">No data yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-sm font-medium text-neutral-400">Cost per Sprint</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="sprint" tick={{ fill: '#999', fontSize: 12 }} />
            <YAxis yAxisId="cost" tick={{ fill: '#999', fontSize: 12 }} />
            <YAxis yAxisId="avg" orientation="right" tick={{ fill: '#999', fontSize: 12 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
              labelStyle={{ color: '#ccc' }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => [`$${Number(value).toFixed(2)}`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="cost" dataKey="totalCost" name="Total Cost" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            <Line yAxisId="avg" dataKey="avgCostPerTask" name="Avg/Task" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
