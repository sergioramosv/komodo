'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface ReviewPassRate {
  sprint: string;
  total: number;
  passedFirst: number;
  rate: number;
}

export function ReviewPassRateChart({ data }: { data: ReviewPassRate[] }) {
  if (data.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Review Pass Rate</h2>
        <p className="text-xs text-neutral-600">No data yet.</p>
      </section>
    );
  }

  const avgRate = Math.round(data.reduce((s, d) => s + d.rate, 0) / data.length);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-400">Review Pass Rate</h2>
        <span className="text-lg font-bold tabular-nums">{avgRate}%</span>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="sprint" tick={{ fill: '#999', fontSize: 12 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#999', fontSize: 12 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
              labelStyle={{ color: '#ccc' }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => [`${value}%`, name]}
            />
            <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="3 3" label={{ value: '80%', fill: '#22c55e', fontSize: 11 }} />
            <Area
              dataKey="rate"
              name="Pass Rate"
              stroke="#22c55e"
              fill="#22c55e"
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
