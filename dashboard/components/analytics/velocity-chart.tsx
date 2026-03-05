'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface SprintVelocity {
  sprint: string;
  tasksCompleted: number;
  devPoints: number;
}

export function VelocityChart({ data }: { data: SprintVelocity[] }) {
  if (data.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Velocity per Sprint</h2>
        <p className="text-xs text-neutral-600">No data yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-sm font-medium text-neutral-400">Velocity per Sprint</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="sprint" tick={{ fill: '#999', fontSize: 12 }} />
            <YAxis tick={{ fill: '#999', fontSize: 12 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
              labelStyle={{ color: '#ccc' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="tasksCompleted" name="Tasks" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="devPoints" name="Dev Points" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
