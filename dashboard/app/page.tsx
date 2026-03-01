'use client';

import { useKomodoSocket } from '@/hooks/useKomodoSocket';
import { useAgentStates } from '@/hooks/useAgentStates';
import { useOfficeFeedback } from '@/hooks/useOfficeFeedback';
import { ConnectionStatus } from '@/components/connection-status';
import { OfficeScene } from '@/components/office-scene';
import type { Phase, AgentStatus, DashboardEvent } from '@/lib/types';

/* ── Phase config ── */

const PHASE_CONFIG: Record<Phase, { icon: string; label: string; color: string }> = {
  idle: { icon: '○', label: 'Idle', color: 'text-neutral-500' },
  planning: { icon: '✎', label: 'Planning', color: 'text-violet-400' },
  coding: { icon: '⌨', label: 'Coding', color: 'text-blue-400' },
  reviewing: { icon: '⊘', label: 'Reviewing', color: 'text-amber-400' },
  merging: { icon: '⇢', label: 'Merging', color: 'text-green-400' },
};

const PHASE_ORDER: Phase[] = ['planning', 'coding', 'reviewing', 'merging'];

/* ── Agent status colors ── */

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: 'bg-neutral-600',
  walking: 'bg-yellow-500',
  working: 'bg-blue-500',
  done: 'bg-green-500',
};

const STATUS_RING: Record<AgentStatus, string> = {
  idle: '',
  walking: 'ring-2 ring-yellow-500/30',
  working: 'ring-2 ring-blue-500/30 animate-pulse',
  done: 'ring-2 ring-green-500/30',
};

/* ── Event type colors ── */

const EVENT_COLORS: Record<string, string> = {
  'agent:state-change': 'text-blue-400',
  'task:started': 'text-violet-400',
  'task:completed': 'text-green-400',
  'pr:created': 'text-cyan-400',
  'pr:merged': 'text-green-400',
  'cost:updated': 'text-amber-400',
  'review:cycle:start': 'text-orange-400',
  'review:cycle:end': 'text-orange-400',
};

/* ── Page ── */

export default function DashboardPage() {
  const { snapshot, connected, events } = useKomodoSocket();
  const agentStates = useAgentStates(snapshot, connected);
  const feedback = useOfficeFeedback(events, snapshot);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ConnectionStatus connected={connected} />
      </div>

      {!snapshot ? (
        <p className="text-neutral-500">Waiting for orchestrator connection...</p>
      ) : (
        <>
          {/* Current Task Card */}
          <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-3 text-sm font-medium text-neutral-400">Current Task</h2>
            {snapshot.currentTask ? (
              <div className="space-y-2">
                <p className="text-lg font-semibold">
                  {snapshot.taskDetails?.title ?? snapshot.currentTask}
                </p>
                {snapshot.taskDetails?.userStory && (
                  <p className="text-sm text-neutral-400">{snapshot.taskDetails.userStory}</p>
                )}
                <div className="flex gap-4 text-xs text-neutral-500">
                  {snapshot.taskDetails?.sprint && (
                    <span className="rounded bg-neutral-800 px-2 py-0.5">
                      {snapshot.taskDetails.sprint}
                    </span>
                  )}
                  {snapshot.taskDetails?.devPoints != null && (
                    <span className="rounded bg-neutral-800 px-2 py-0.5">
                      {snapshot.taskDetails.devPoints} pts
                    </span>
                  )}
                  {snapshot.currentPR && (
                    <span className="rounded bg-neutral-800 px-2 py-0.5">
                      PR: {snapshot.currentPR}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-neutral-500">No task running</p>
            )}
          </section>

          {/* Office Scene — real-time agent visualization */}
          <OfficeScene
            agents={agentStates.agents}
            phase={agentStates.phase}
            feedback={feedback}
          />

          {/* Phase Indicator */}
          <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-sm font-medium text-neutral-400">Phase</h2>
            {snapshot.phase === 'idle' ? (
              <div className="flex items-center gap-2">
                <span className="text-lg text-neutral-500">○</span>
                <span className="text-neutral-500">Idle — waiting for next task</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                {PHASE_ORDER.map((phase, i) => {
                  const cfg = PHASE_CONFIG[phase];
                  const isActive = snapshot.phase === phase;
                  const isPast = PHASE_ORDER.indexOf(snapshot.phase as Phase) > i;

                  return (
                    <div key={phase} className="flex items-center">
                      {i > 0 && (
                        <div
                          className={`mx-2 h-px w-8 ${
                            isPast ? 'bg-green-500' : 'bg-neutral-700'
                          }`}
                        />
                      )}
                      <div
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
                          isActive
                            ? `${cfg.color} bg-neutral-800 ring-1 ring-neutral-700`
                            : isPast
                              ? 'text-green-500 bg-green-500/10'
                              : 'text-neutral-600'
                        }`}
                      >
                        <span className="text-base">{isActive ? cfg.icon : isPast ? '✓' : cfg.icon}</span>
                        {cfg.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Agent Cards */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Object.values(snapshot.agents).map((agent) => {
              const dotColor = STATUS_COLORS[agent.status] ?? 'bg-neutral-600';
              const ring = STATUS_RING[agent.status] ?? '';

              return (
                <div
                  key={agent.name}
                  className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block h-3 w-3 rounded-full ${dotColor} ${ring}`}
                    />
                    <h3 className="text-sm font-semibold">{agent.name}</h3>
                    <span
                      className={`ml-auto rounded px-2 py-0.5 text-xs font-medium capitalize ${
                        agent.status === 'working'
                          ? 'bg-blue-500/20 text-blue-400'
                          : agent.status === 'done'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-neutral-800 text-neutral-400'
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>
                  {agent.currentTask && (
                    <p className="mt-2 truncate text-sm text-neutral-400">{agent.currentTask}</p>
                  )}
                  {agent.startedAt && (
                    <p className="mt-1 text-xs text-neutral-500">
                      Since {new Date(agent.startedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              );
            })}
          </section>

          {/* Stats: Cost + Sprint Progress */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Cost counter */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <h3 className="mb-1 text-sm font-medium text-neutral-400">Accumulated Cost</h3>
              <p className="text-3xl font-bold tabular-nums">
                ${snapshot.totalCost.toFixed(2)}
                <span className="ml-1 text-sm font-normal text-neutral-500">USD</span>
              </p>
            </div>

            {/* Sprint progress */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <h3 className="mb-1 text-sm font-medium text-neutral-400">Sprint Progress</h3>
              <div className="mt-2">
                {(() => {
                  const completed = snapshot.tasksCompleted;
                  const total = snapshot.totalTasks ?? 0;
                  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

                  return (
                    <>
                      <div className="flex items-baseline justify-between">
                        <p className="text-2xl font-bold tabular-nums">
                          {completed}
                          {total > 0 && (
                            <span className="text-sm font-normal text-neutral-500">
                              /{total}
                            </span>
                          )}
                          <span className="ml-2 text-sm font-normal text-neutral-500">
                            tasks completed
                          </span>
                        </p>
                        {total > 0 && (
                          <span className="text-sm font-medium text-neutral-400">{pct}%</span>
                        )}
                      </div>
                      {total > 0 && (
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
                          <div
                            className="h-full rounded-full bg-green-500 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </section>

          {/* Review Cycle */}
          {snapshot.reviewCycle > 0 && (
            <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-medium text-neutral-400">Review Cycle</h3>
                <span className="rounded bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-400">
                  Cycle {snapshot.reviewCycle}
                </span>
              </div>
            </section>
          )}

          {/* Event Timeline */}
          <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-sm font-medium text-neutral-400">Recent Events</h2>
            {events.length === 0 ? (
              <p className="text-sm text-neutral-600">No events yet</p>
            ) : (
              <div className="space-y-1">
                {events.map((evt) => (
                  <EventRow key={evt.id} event={evt} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* ── Event Row Component ── */

function EventRow({ event }: { event: DashboardEvent }) {
  const time = event.timestamp
    ? new Date(event.timestamp).toLocaleTimeString()
    : '--:--:--';

  const color = EVENT_COLORS[event.type] ?? 'text-neutral-400';

  return (
    <div className="flex items-start gap-3 rounded px-2 py-1.5 text-sm hover:bg-neutral-800/50">
      <span className="shrink-0 tabular-nums text-neutral-600">{time}</span>
      {event.agentName && (
        <span className={`shrink-0 font-medium ${color}`}>{event.agentName}</span>
      )}
      <span className="text-neutral-300">{event.message}</span>
    </div>
  );
}
