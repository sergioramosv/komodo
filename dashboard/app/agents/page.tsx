'use client';

import { useKomodoSocket } from '@/hooks/useKomodoSocket';
import { ConnectionStatus } from '@/components/connection-status';

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-neutral-600',
  walking: 'bg-yellow-500',
  working: 'bg-blue-500',
  done: 'bg-green-500',
};

export default function AgentsPage() {
  const { snapshot, connected } = useKomodoSocket();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <ConnectionStatus connected={connected} />
      </div>

      {!snapshot ? (
        <p className="text-neutral-500">Waiting for orchestrator connection...</p>
      ) : (
        <div className="space-y-4">
          {Object.values(snapshot.agents).map((agent) => (
            <div
              key={agent.name}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-5"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${STATUS_COLORS[agent.status] ?? 'bg-neutral-600'}`}
                />
                <h2 className="text-lg font-semibold">{agent.name}</h2>
                <span className="ml-auto rounded bg-neutral-800 px-2 py-0.5 text-xs capitalize text-neutral-300">
                  {agent.status}
                </span>
              </div>

              {agent.currentTask && (
                <p className="mt-3 text-sm text-neutral-400">
                  Current task: <span className="text-neutral-200">{agent.currentTask}</span>
                </p>
              )}
              {agent.startedAt && (
                <p className="mt-1 text-xs text-neutral-500">
                  Started: {new Date(agent.startedAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
