'use client';

import { useKomodoSocket } from '@/hooks/useKomodoSocket';
import { ConnectionStatus } from '@/components/connection-status';

export default function DashboardPage() {
  const { snapshot, connected } = useKomodoSocket();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ConnectionStatus connected={connected} />
      </div>

      {!snapshot ? (
        <p className="text-neutral-500">Waiting for orchestrator connection...</p>
      ) : (
        <>
          {/* Phase */}
          <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-2 text-sm font-medium text-neutral-400">Current Phase</h2>
            <p className="text-lg font-semibold capitalize">{snapshot.phase}</p>
            {snapshot.currentTask && (
              <p className="mt-1 text-sm text-neutral-400">Task: {snapshot.currentTask}</p>
            )}
            {snapshot.currentPR && (
              <p className="mt-1 text-sm text-neutral-400">PR: {snapshot.currentPR}</p>
            )}
          </section>

          {/* Agents */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Object.values(snapshot.agents).map((agent) => (
              <div
                key={agent.name}
                className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
              >
                <h3 className="text-sm font-medium text-neutral-400">{agent.name}</h3>
                <p className="mt-1 text-lg font-semibold capitalize">{agent.status}</p>
                {agent.currentTask && (
                  <p className="mt-1 truncate text-sm text-neutral-500">{agent.currentTask}</p>
                )}
              </div>
            ))}
          </section>

          {/* Stats */}
          <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <h3 className="text-sm font-medium text-neutral-400">Tasks Completed</h3>
              <p className="mt-1 text-2xl font-bold">{snapshot.tasksCompleted}</p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <h3 className="text-sm font-medium text-neutral-400">Review Cycle</h3>
              <p className="mt-1 text-2xl font-bold">{snapshot.reviewCycle}</p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
